package io.parity.unstation.android

/**
 * JNI bridge to the Rust core's camera-publish intake (`crates/unstation-app/src/camera.rs`).
 *
 * The encoded H.264 access units the capture engine produces are pushed straight into Rust
 * over these native calls — NOT through the JSON `invoke` bridge, which would base64 + serialize
 * every frame. The symbols live in the app's own cdylib (`libunstation_android_lib.so`, the same
 * library Tauri loads), exported as `Java_io_parity_unstation_android_CameraBridge_*`.
 */
object CameraBridge {
    init {
        // Already loaded by Tauri at startup; this is a harmless no-op that also makes the
        // dependency explicit (and covers the case of being touched before Tauri's load).
        try {
            System.loadLibrary("unstation_android_lib")
        } catch (_: Throwable) {
        }
    }

    /** Report the encoder's codec-specific data (raw SPS/PPS NAL payloads) + display size. */
    external fun nativeConfig(sps: ByteArray, pps: ByteArray, width: Int, height: Int)

    /** Push one encoded access unit (Annex-B framed) with its presentation time (µs). */
    external fun nativeVideoAu(data: ByteArray, ptsUs: Long, keyframe: Boolean)

    /**
     * Split a MediaCodec `BUFFER_FLAG_CODEC_CONFIG` buffer (Annex-B SPS+PPS) into the raw SPS
     * (NAL type 7) and PPS (NAL type 8) payloads, start codes stripped. Returns null on either
     * missing so the caller can wait for a well-formed CSD.
     */
    fun splitCsd(csd: ByteArray): Pair<ByteArray, ByteArray>? {
        var sps: ByteArray? = null
        var pps: ByteArray? = null
        val starts = ArrayList<Int>()
        var i = 0
        while (i + 3 <= csd.size) {
            if (csd[i].toInt() == 0 && csd[i + 1].toInt() == 0 && csd[i + 2].toInt() == 1) {
                starts.add(i + 3)
                i += 3
            } else {
                i++
            }
        }
        for ((idx, payloadStart) in starts.withIndex()) {
            var end = if (idx + 1 < starts.size) starts[idx + 1] - 3 else csd.size
            // A 4-byte start code (00 00 00 01) leaves a trailing 0 on the previous NAL.
            if (end > payloadStart && end < csd.size && csd[end - 1].toInt() == 0) end--
            if (payloadStart >= end) continue
            val nal = csd.copyOfRange(payloadStart, end)
            when (nal[0].toInt() and 0x1f) {
                7 -> sps = nal
                8 -> pps = nal
            }
        }
        val s = sps ?: return null
        val p = pps ?: return null
        return Pair(s, p)
    }
}
