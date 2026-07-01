// Android-only shims, injected before the shared main.js via a Vite virtual module
// (see vite.config.js). Kept OUT of the shared desktop src/ tree so the frontend stays
// single-sourced; the shared code exposes neutral `window.__*` hooks that are no-ops on
// desktop and wired here on Android.

// ── M2: same-device pairing ────────────────────────────────────────────────────────────
// On desktop you scan the pairing QR with your phone. On Android the Polkadot app is on the
// SAME device, so instead of scanning we fire the pairing deep-link (polkadotapp://pair?…)
// straight at it via the opener plugin's ACTION_VIEW intent. The QR stays visible as a
// cross-device fallback. `window.__onPairingPayload(payload)` is called from main.js's
// pairing flow with the live payload (the same string the QR encodes).
(function () {
  "use strict";
  let lastPayload = null;
  let launched = false;

  async function openExternal(url) {
    try {
      const t = window.__TAURI__;
      if (t && t.core && typeof t.core.invoke === "function") {
        await t.core.invoke("plugin:opener|open_url", { url });
        return true;
      }
    } catch (e) {
      // ActivityNotFound (no Polkadot app installed) lands here — fall through to the QR.
      console.warn("[android] opener open_url failed (is the Polkadot app installed?)", e);
      return false;
    }
    try {
      window.location.href = url;
      return true;
    } catch (e) {
      console.warn("[android] location fallback failed", e);
      return false;
    }
  }

  window.__onPairingPayload = function (payload) {
    if (!payload || typeof payload !== "string") return;
    if (payload === lastPayload) return; // the status stream re-fires 'pairing' ticks
    lastPayload = payload;
    if (launched) return;

    // host-papp emits the full pairing deep-link URI; if we ever get a bare handshake blob,
    // wrap it in the scheme the Polkadot app registers (polkadotapp://pair).
    let url = payload;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(payload)) {
      url = "polkadotapp://pair?handshake=" + encodeURIComponent(payload);
    }
    if (!/^polkadot/i.test(url)) return; // never launch the desktop placeholder URI

    launched = true;
    console.log("[android] launching pairing deep-link:", url.slice(0, 60) + "…");
    openExternal(url).then((ok) => {
      if (!ok) launched = false; // allow a retry on the next payload if the launch failed
    });
  };

  // Reword the onboarding for the same-device (deep-link) flow — there's no QR to scan.
  // (The QR + "I've scanned it" button are hidden via ui/android.css.) Module scripts run
  // after the document is parsed, so the onboarding DOM already exists here.
  try {
    var scene = document.querySelector('[data-scene="onboarding"]');
    if (scene) {
      var p = scene.querySelector(".qr-copy p");
      if (p) {
        p.innerHTML =
          "Your <b>Polkadot app</b> just opened — <b>approve the network-access request</b> " +
          "there (you may need to sign), then come back. Your keys never leave your phone; " +
          "this device only gets a small, revocable allowance. Sign-in is required to watch or go live.";
      }
    }
  } catch (e) {
    console.warn("[android] onboarding copy rewrite failed", e);
  }

  console.log("[android] shims loaded (pairing deep-link active)");
})();

// Set the host platform as early as possible (getAdapter() in sso.js reads it for the
// pairing handshake so the Polkadot app shows "mobile", not "desktop").
window.__unstationPlatformType = "mobile";

// ── M3: HLS playback ─────────────────────────────────────────────────────────────────────
// Android's Chromium WebView has no native HLS, so main.js's canPlayType('application/
// vnd.apple.mpegurl') gate fails. main.js delegates to window.__hlsPlay(v, url, catchup) (a
// platform-neutral seam) BEFORE that gate; here we feed the stream through hls.js (MSE).
(function () {
  "use strict";
  var Hls = window.Hls;
  console.log("[android] hls.js", Hls && Hls.version ? Hls.version : "MISSING");
  var current = null;
  window.__hlsPlay = function (v, url, catchup) {
    if (!Hls || !Hls.isSupported()) {
      console.warn("[android] hls.js unsupported; cannot play HLS");
      if (catchup) { catchup.textContent = "This device can't play the stream format."; catchup.style.display = "grid"; }
      return;
    }
    try {
      if (current) { current.destroy(); current = null; }
      // Low-latency live tuning to sit near the edge of the ~1-2s CMAF fragments.
      current = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        // Hold the live edge: if playback drifts more than this many segments behind (or a
        // stall pushes it back), hls.js seeks forward to liveSyncDurationCount instead of
        // playing 1x forever from wherever it landed. Without it the player falls steadily
        // behind a live source.
        liveMaxLatencyDurationCount: 6,
        backBufferLength: 8,
        manifestLoadingMaxRetry: 10,
        levelLoadingMaxRetry: 10,
        fragLoadingMaxRetry: 10,
      });
      current.on(Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
      current.on(Hls.Events.ERROR, function (_e, data) {
        if (!data || !data.fatal) return;
        console.warn("[android] hls fatal:", data.type, data.details);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) current.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) current.recoverMediaError();
      });
      current.loadSource(url);
      current.attachMedia(v);
      v.style.display = "block";
      v.addEventListener("playing", function () { if (catchup) catchup.style.display = "none"; });
      console.log("[android] hls.js attached:", url);
    } catch (e) {
      console.error("[android] hls attach failed", e);
    }
  };
})();
