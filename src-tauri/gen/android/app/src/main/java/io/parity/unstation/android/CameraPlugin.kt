package io.parity.unstation.android

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
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
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

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

    private fun startEngine() {
        bgThread = HandlerThread("unstation-cam").apply { start() }
        bgHandler = Handler(bgThread!!.looper)

        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, W, H).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // ~1s GOP → one CMAF fragment per GOP
            setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileHigh)
            // Low-latency, no B-frames (matches the Rust muxer's composition-offset=0 assumption).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) setInteger(MediaFormat.KEY_LATENCY, 1)
        }
        val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        enc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = enc.createInputSurface()
        enc.start()
        encoder = enc

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
        } ?: ids.firstOrNull() ?: throw IllegalStateException("no camera")

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
