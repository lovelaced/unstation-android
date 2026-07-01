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

  // Tell host-papp this is a mobile host (cosmetic; affects the paired-device label).
  window.__unstationPlatformType = "mobile";

  console.log("[android] shims loaded (pairing deep-link active)");
})();
