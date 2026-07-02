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

// ── Design pass: native bottom navigation ──────────────────────────────────────────────
// The shared titlebar tabs are text buttons; ui/android.css relocates the bar to the
// bottom. Here we rebuild each tab as icon + label (inline SVGs in the brand's stroke
// style — same 24px/1.8 stroke vocabulary as the shared markup's icons). The existing
// #goLiveRec live badge is MOVED (same node — state.js holds a reference) onto the
// Go Live icon's corner. Module scripts run after the document is parsed, so the DOM
// exists; this runs before main.js binds its listeners, and listeners bind to the
// buttons themselves, so the rebuild is invisible to the shared code.
(function () {
  "use strict";
  var STROKE = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  var ICONS = {
    // Watch — the brand's play triangle (the wordmark's play-dot, unboxed).
    watch: '<svg' + STROKE + '><path d="M7 4.8 19 12 7 19.2Z"/></svg>',
    // Go Live — a broadcast dot with radiating arcs.
    golive: '<svg' + STROKE + '><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><path d="M19.1 4.9c3.9 3.9 3.9 10.3 0 14.2"/><path d="M4.9 19.1c-3.9-3.9-3.9-10.3 0-14.2"/></svg>',
    // Settings — gear.
    settings: '<svg' + STROKE + '><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  };
  try {
    document.querySelectorAll(".titlebar .tab").forEach(function (btn) {
      var svg = ICONS[btn.dataset.tab];
      if (!svg) return;
      var rec = btn.querySelector(".rec"); // #goLiveRec — must survive (state.js contract)
      var label = (btn.textContent || "").trim();
      btn.textContent = "";
      var ico = document.createElement("span");
      ico.className = "tab-ico";
      ico.innerHTML = svg;
      if (rec) ico.appendChild(rec); // the red live dot rides the icon's corner
      var lbl = document.createElement("span");
      lbl.className = "tab-lbl";
      lbl.textContent = label;
      btn.append(ico, lbl);
    });
    // Thumb-reachable Leave: move the HUD's Leave button (same node — main.js binds it
    // by id) to the end of the connection panel, which portrait CSS shows below the
    // video. Landscape keeps it inside the pill-toggled drawer.
    var net = document.getElementById("net");
    var leave = document.getElementById("leaveWatchBtn");
    if (net && leave) net.appendChild(leave);
  } catch (e) {
    console.warn("[android] bottom-nav rebuild failed", e);
  }
})();

// ── Design pass: hardware back button ──────────────────────────────────────────────────
// Wry's default Android back handler calls webview.goBack() when history allows and
// backgrounds the app otherwise. We keep the SPA history exactly ONE entry deep while
// off the entry scene ({u:1}, replaced — never pushed again — on further scene changes,
// so Rejoin/deep-links can't grow it unboundedly) and collapse to the root ({u:0}) on
// entry. A back press therefore pops to the root and lands in the popstate handler,
// which routes: overlays close first; live watch → Leave; publish console → entry with
// the stream still running (the tab badge shows it); entry itself has no history left,
// so the next press backgrounds the app.
(function () {
  "use strict";
  var lastScene = "entry"; // mirrors S.curState via the __onSceneChange seam
  try { history.replaceState({ u: 0 }, ""); } catch (e) {}

  function atLeaf() { return !!(history.state && history.state.u === 1); }
  function arm() { // ensure exactly one back-consumable entry exists
    try {
      if (atLeaf()) history.replaceState({ u: 1 }, "");
      else history.pushState({ u: 1 }, "");
    } catch (e) {}
  }

  // Called synchronously from state.js go() on every scene change.
  window.__onSceneChange = function (scene) {
    lastScene = scene;
    if (scene === "entry") {
      // Home: consume the leaf so the NEXT back press backgrounds the app. The
      // resulting popstate no-ops below (lastScene is already 'entry').
      if (atLeaf()) { try { history.back(); } catch (e) {} }
    } else {
      arm();
    }
  };

  window.addEventListener("popstate", function (ev) {
    var st = ev.state || {};
    if (st.u !== 0) return;            // not our root marker — ignore (guards stray fires)
    if (lastScene === "entry") return; // our own collapsing back(), or already home
    // 1) Overlays close first, and the leaf is re-armed (scene unchanged).
    var qr = document.getElementById("inviteQrBox");
    if (qr && !qr.hidden) {
      var close = document.getElementById("inviteQrClose");
      if (close) close.click(); else qr.hidden = true;
      arm();
      return;
    }
    var win = document.getElementById("win");
    if (win && win.dataset.net === "open") {
      win.dataset.net = "closed";
      arm();
      return;
    }
    // 2) Live watch (incl. the give-up card, whose exit IS Leave) → confirmation-free
    //    leave; finding → cancel the in-flight watch the same way.
    if (lastScene === "live" || lastScene === "seed" || lastScene === "catchup" || lastScene === "finding") {
      var leave = document.getElementById("leaveWatchBtn");
      if (leave) { leave.click(); return; } // leaveWatch → go('entry') keeps us at the root
    }
    // 3) Publish console/setup (stream keeps running — the tab badge shows it),
    //    settings, onboarding, ended → home.
    if (window.__go) window.__go("entry");
  });
})();

// ── Design pass: keyboard watcher ──────────────────────────────────────────────────────
// windowSoftInputMode=adjustResize shrinks the whole viewport when the keyboard opens;
// without this the bottom nav rides up and squats above the keyboard. Track the largest
// seen height per orientation and flag big shrinks as "keyboard open" (ui/android.css
// hides the nav on body.kb-open).
(function () {
  "use strict";
  var maxH = { p: 0, l: 0 };
  function check() {
    var h = window.innerHeight, w = window.innerWidth, k = w > h ? "l" : "p";
    if (h > maxH[k]) maxH[k] = h;
    document.body.classList.toggle("kb-open", maxH[k] - h > 160);
  }
  window.addEventListener("resize", check);
  check();
})();

// ── M4: camera publish ───────────────────────────────────────────────────────────────────
// main.js calls these seams around go-live/stop. On desktop they're absent (RTMP/OBS ingest);
// on Android they drive the CameraPlugin (Camera2 → MediaCodec → the Rust muxer via JNI).
// start_publish opens the AU intake first, so startCapture is safe to call right after.
window.__onPublishStarted = function () {
  var t = window.__TAURI__;
  if (t && t.core && typeof t.core.invoke === "function") {
    // Camera quality comes from Settings ("Camera quality"); 480/720/1080. The plugin
    // treats anything unknown as the 720p default, so a stale stored value is harmless.
    var q = null;
    try { q = localStorage.getItem("camQuality"); } catch (e) {}
    return t.core.invoke("camera_start", { quality: q || null });
  }
  return Promise.resolve();
};
window.__onPublishStopped = function () {
  var t = window.__TAURI__;
  if (t && t.core && typeof t.core.invoke === "function") {
    return t.core.invoke("camera_stop");
  }
  return Promise.resolve();
};

// The RTMP/OBS "Connect your encoder" UI is desktop-only — on mobile the phone camera is the
// source, so there's no external encoder, server, or stream key. Hide that block and reword the
// encoder-centric copy to be camera-native.
(function () {
  "use strict";
  function cleanup() {
    var card = document.querySelector(".ingest-card");
    if (card) card.style.display = "none";
    var rail = document.querySelector(".pub-rail");
    if (rail) {
      rail.querySelectorAll(".eyebrow").forEach(function (e) {
        if (/encoder/i.test(e.textContent || "")) e.style.display = "none";
      });
    }
    var b = document.querySelector("#pubWaiting b");
    if (b) b.textContent = "Starting your camera…";
    var note = document.querySelector("#pubWaiting > div");
    if (note) note.textContent = "Your camera stream is starting — one moment.";
    var ps = document.getElementById("phStatus");
    if (ps) ps.textContent = "Camera";
    var pn = document.getElementById("phNote");
    if (pn) pn.textContent = "You’re live from your phone camera.";
    // NOTE: "End stream" is laid out for mobile in ui/android.css (a sticky, full-width bar
    // at the bottom of the publish-live column). An earlier position:fixed pin injected here
    // collided with the bottom tab bar and got trapped by the scene-transition transform —
    // the sticky CSS rule replaces it.
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cleanup);
  else cleanup();
})();

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

  // D2 player-control seams (used guardedly by desktop/src/player.js): live-edge lag in
  // seconds, and a seek-to-live that respects hls.js's own live-sync target. `current` is
  // whichever Hls instance attached last (the watch player in practice — the self-preview
  // only runs while publishing).
  window.__hlsLatency = function () {
    return current && isFinite(current.latency) ? current.latency : null;
  };
  window.__hlsSkipToLive = function () {
    try {
      if (current && current.media && isFinite(current.liveSyncPosition)) {
        current.media.currentTime = current.liveSyncPosition;
      }
    } catch (e) {
      console.warn("[android] skip-to-live failed", e);
    }
  };
})();
