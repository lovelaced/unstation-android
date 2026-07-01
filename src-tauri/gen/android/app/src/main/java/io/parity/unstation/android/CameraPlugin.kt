package io.parity.unstation.android

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.view.WindowManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class KeepAwakeArgs {
    var on: Boolean = false
}

/**
 * Camera-publish capture (M4): Camera2 feeds a hardware H.264 `MediaCodec` encoder; the encoded
 * access units are pushed to the Rust core via [CameraBridge], which muxes them into CMAF and
 * publishes them to the mesh. No preview surface here — the publisher's self-preview is the HLS
 * playback of the muxed stream (same path a viewer uses), so we only feed the encoder.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.CAMERA], alias = "camera"),
    ]
)
class CameraPlugin(private val activity: Activity) : Plugin(activity) {
    private var encoder: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var cameraDevice: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var bgThread: HandlerThread? = null
    private var bgHandler: Handler? = null
    @Volatile private var draining = false
    private var drainThread: Thread? = null

    companion object {
        private const val TAG = "UnstationCamera"
        private const val W = 1280
        private const val H = 720
        private const val BITRATE = 2_500_000
        private const val FPS = 30
    }

    @Command
    fun startCapture(invoke: Invoke) {
        // If the camera isn't granted yet, request it and proceed automatically once the user
        // responds (via onCameraPermission) — no "go back and Go Live again". Tauri holds the
        // invoke across the prompt, so a single Go Live tap flows straight through.
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            doStart(invoke)
        } else {
            requestPermissionForAlias("camera", invoke, "onCameraPermission")
        }
    }

    @PermissionCallback
    fun onCameraPermission(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            doStart(invoke)
        } else {
            invoke.reject("Camera access is needed to go live — enable it in Settings.")
        }
    }

    private fun doStart(invoke: Invoke) {
        try {
            startEngine()
            // Keep the broadcast alive through backgrounding (typed camera FGS). Started
            // from the foreground with camera granted — the API 34 preconditions hold.
            PublishForegroundService.start(activity)
            // Best-effort notification permission (13+) so the "You're live" notice shows;
            // the service runs either way.
            if (Build.VERSION.SDK_INT >= 33 &&
                activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
            ) {
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 9001)
            }
            invoke.resolve()
        } catch (e: Throwable) {
            Log.e(TAG, "startCapture failed", e)
            stopEngine()
            invoke.reject("Couldn't start the camera: ${e.message}")
        }
    }

    @Command
    fun stopCapture(invoke: Invoke) {
        stopEngine()
        invoke.resolve()
    }

    /** Hold/release the screen-on flag (watching or broadcasting — a phone that dims
     *  mid-match kills the party). */
    @Command
    fun setKeepAwake(invoke: Invoke) {
        val on = invoke.parseArgs(KeepAwakeArgs::class.java).on
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        invoke.resolve()
    }

    /** The recovery path after a "don't ask again" camera denial: open this app's
     *  system settings page so the user can grant it and come back. */
    @Command
    fun openAppSettings(invoke: Invoke) {
        try {
            val i = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", activity.packageName, null),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(i)
            invoke.resolve()
        } catch (e: Throwable) {
            invoke.reject("Couldn't open Settings: ${e.message}")
        }
    }

    private fun startEngine() {
        bgThread = HandlerThread("unstation-cam").apply { start() }
        bgHandler = Handler(bgThread!!.looper)

        // Try H.264 profiles from best to most-compatible. Many low-end / older devices
        // reject High-profile configure() outright — without a fallback that killed
        // publish entirely on those phones. Baseline is universally supported.
        val profiles = intArrayOf(
            MediaCodecInfo.CodecProfileLevel.AVCProfileHigh,
            MediaCodecInfo.CodecProfileLevel.AVCProfileMain,
            MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline,
        )
        var enc: MediaCodec? = null
        var lastErr: Throwable? = null
        for ((i, profile) in profiles.withIndex()) {
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, W, H).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // ~1s GOP → one CMAF fragment per GOP
                setInteger(MediaFormat.KEY_PROFILE, profile)
                // Low-latency, no B-frames (matches the Rust muxer's composition-offset=0 assumption).
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) setInteger(MediaFormat.KEY_LATENCY, 1)
            }
            try {
                val c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                c.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                inputSurface = c.createInputSurface()
                c.start()
                enc = c
                if (i > 0) Log.w(TAG, "H.264 profile $profile after ${i} fallback(s)")
                break
            } catch (e: Throwable) {
                lastErr = e
                Log.w(TAG, "encoder configure failed for profile $profile: ${e.message}")
            }
        }
        encoder = enc ?: throw (lastErr ?: IllegalStateException("no usable H.264 encoder"))

        startDrain()
        openCamera()
        Log.i(TAG, "capture started ${W}x${H}@${FPS} ${BITRATE}bps")
    }

    private fun startDrain() {
        draining = true
        drainThread = Thread {
            val info = MediaCodec.BufferInfo()
            val enc = encoder ?: return@Thread
            while (draining) {
                val idx = try {
                    enc.dequeueOutputBuffer(info, 10_000)
                } catch (e: IllegalStateException) {
                    break
                }
                if (idx < 0) continue
                val buf = enc.getOutputBuffer(idx)
                if (buf != null && info.size > 0) {
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val bytes = ByteArray(info.size)
                    buf.get(bytes)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        CameraBridge.splitCsd(bytes)?.let { (sps, pps) ->
                            CameraBridge.nativeConfig(sps, pps, W, H)
                        }
                    } else {
                        val keyframe = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
                        CameraBridge.nativeVideoAu(bytes, info.presentationTimeUs, keyframe)
                    }
                }
                try {
                    enc.releaseOutputBuffer(idx, false)
                } catch (_: IllegalStateException) {
                    break
                }
            }
        }.also { it.start() }
    }

    private fun openCamera() {
        val cm = activity.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val ids = cm.cameraIdList
        val backId = ids.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
                CameraCharacteristics.LENS_FACING_BACK
        } ?: ids.firstOrNull() ?: throw IllegalStateException("This device has no usable camera.")

        cm.openCamera(backId, object : CameraDevice.StateCallback() {
            override fun onOpened(device: CameraDevice) {
                cameraDevice = device
                val surface = inputSurface ?: return
                val req = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                    addTarget(surface)
                }
                @Suppress("DEPRECATION")
                device.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(s: CameraCaptureSession) {
                        session = s
                        try {
                            s.setRepeatingRequest(req.build(), null, bgHandler)
                        } catch (e: Exception) {
                            Log.e(TAG, "setRepeatingRequest failed", e)
                        }
                    }
                    override fun onConfigureFailed(s: CameraCaptureSession) {
                        Log.e(TAG, "capture session configure failed")
                    }
                }, bgHandler)
            }
            override fun onDisconnected(device: CameraDevice) { device.close() }
            override fun onError(device: CameraDevice, error: Int) {
                Log.e(TAG, "camera error $error"); device.close()
            }
        }, bgHandler)
    }

    private fun stopEngine() {
        PublishForegroundService.stop(activity)
        draining = false
        try { drainThread?.join(500) } catch (_: InterruptedException) {}
        drainThread = null
        try { session?.close() } catch (_: Throwable) {}
        session = null
        try { cameraDevice?.close() } catch (_: Throwable) {}
        cameraDevice = null
        try { encoder?.stop() } catch (_: Throwable) {}
        try { encoder?.release() } catch (_: Throwable) {}
        encoder = null
        try { inputSurface?.release() } catch (_: Throwable) {}
        inputSurface = null
        bgThread?.quitSafely()
        bgThread = null
        bgHandler = null
    }
}
