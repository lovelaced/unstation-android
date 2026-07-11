<div align="center">

# Unstation for Android

*Watch and broadcast live video from your phone, straight to your friends, with no server and no account.*

![Platform](https://img.shields.io/badge/platform-Android%208%2B-3DDC84?style=flat-square&logo=android&logoColor=white)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)
[![CI](https://img.shields.io/github/actions/workflow/status/lovelaced/unstation-android/ci.yml?style=flat-square&label=ci)](https://github.com/lovelaced/unstation-android/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-experimental-orange?style=flat-square)

<img src="assets/screenshots/go-live-console.png" alt="Unstation broadcasting live from the phone camera: preview, preflight checks, viewer count, and real bitrate" width="340">

</div>

---

Unstation for Android is the mobile companion to [Unstation](https://github.com/lovelaced/unstation-desktop). Point your camera at the action and go live: the video goes straight from your phone to your friends, with nothing hosted in the middle and no one who can take it down. Your app checks every stream automatically, so no one can slip you altered video.

**New here?** The [help site](https://lovelaced.github.io/unstation-android/) covers watching, going live, and getting the best experience, in plain language.

## Features

- **Go live from your camera.** Broadcast straight from your phone. Your stream keeps running even when you switch apps or lock the screen.
- **Watch anywhere.** Open a link or type a name to watch, with tap-for-sound, skip-to-live, and rotate-for-fullscreen.
- **Share with a link or a code.** Send an invite link or show a QR code, and friends who open it land straight in your stream.
- **Clear about what's happening.** Connecting, catching up, and "the broadcast ended" are real messages, never an endless spinner.
- **Sign in once.** A quick tap hands off to the Polkadot app to prove you're a real person. Your keys stay in that app and never move.
- **The same streams as desktop.** Watch and broadcast alongside the [desktop app](https://github.com/lovelaced/unstation-desktop) for Mac, Windows, and Linux.

<div align="center">
  <img src="assets/screenshots/watch-home.png" alt="Home screen: enter a stream name or open an invite link" width="270">
  &nbsp;
  <img src="assets/screenshots/joining-the-mesh.png" alt="Joining the mesh: live progress through resolve, verify, and peer discovery" width="270">
  &nbsp;
  <img src="assets/screenshots/watch-player.png" alt="Watching a live stream with the tap-for-sound pill and connection details" width="270">
</div>

<div align="center">
  <img src="assets/screenshots/landscape-playback.png" alt="Immersive landscape playback: the video fills the screen with a floating HUD" width="700">
  <br><em>Rotate to go fullscreen — the video owns the whole screen.</em>
</div>

## Install

Grab the latest APK from [Releases](https://github.com/lovelaced/unstation-android/releases) and install it (you may need to allow installs from unknown sources), or build it yourself below.

To watch or broadcast you also need the Polkadot app on the same phone. Unstation signs you in with a one-tap handoff to it.

## Build from source

This repo **reuses the desktop app's Rust core and web frontend** rather than duplicating them:

- `src-tauri/` depends on `unstation-desktop/crates/unstation-app` (the shared Tauri command/event layer) via a path dependency, and that in turn depends on the private chain SDK — so **three repos must sit next to each other under the same parent directory**:

  ```
  ~/git/unstation-desktop     # the shared engine + frontend
  ~/git/unstation-android     # this repo
  ~/git/useragent-kit         # the private chain SDK (ask the maintainers for access)
  ```

- The frontend is single-sourced: `vite.config.js` points Vite's `root` at the desktop app's `src/` tree, so the UI is shared verbatim (no copies, no drift). Android-only behavior and styling are injected via the `ui/` shims.

<details>
<summary>Prerequisites</summary>

- Android SDK with **NDK r27+** (r28 recommended — it produces the 16 KB page-aligned libraries Android 15+ requires), the SDK's bundled **cmake + ninja**, and a JDK (17+)
- Rust (stable) with the Android targets: `rustup target add aarch64-linux-android`
- Node + pnpm

</details>

```sh
export ANDROID_HOME=<your-sdk>                       # e.g. ~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/<r28-version>      # NDK_HOME specifically — Tauri reads it
export ANDROID_NDK_HOME=$NDK_HOME ANDROID_NDK_ROOT=$NDK_HOME
export JAVA_HOME=<your-jdk>
# The SDK's bundled cmake+ninja must win over any system cmake:
export PATH=$ANDROID_HOME/cmake/3.22.1/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH

pnpm install
pnpm tauri android build --debug --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n io.parity.unstation.android/.MainActivity
```

> **⚠️ `gen/android` is hand-maintained — do NOT re-run `pnpm tauri android init`.**
> The generated tree is committed and carries real, non-regenerable code:
> `CameraPlugin.kt` / `CameraBridge.kt` (camera publish), `PublishForegroundService.kt`
> (backgrounded-broadcast survival), and `AndroidManifest.xml` entries (camera +
> foreground-service permissions, the service declaration, the `polkadotapp://`
> package-visibility query, the `unstation://` deep-link filter). A regen silently
> clobbers all of it. If a Tauri upgrade requires regenerating, diff the old tree
> back in by hand.

## How it works

The heavy lifting lives in [`unstation-desktop`](https://github.com/lovelaced/unstation-desktop) — the deadline-aware mesh engine, WebRTC transport, statement-store signaling, and verification pipeline. This repo adds the Android-specific layer:

1. **Camera → mesh** — `CameraPlugin.kt` drives Camera2 into a hardware H.264 encoder; encoded frames cross into Rust over JNI (no JSON bridge in the hot path), get muxed into CMAF fragments, and are served to peers exactly like a desktop broadcast.
2. **Playback** — Android's WebView has no native HLS, so the shared player is backed by hls.js, tuned to hold the live edge.
3. **Mobile shell** — a native bottom nav, hardware-back routing, keyboard-aware layout, keep-screen-on while live, and a typed camera foreground service so broadcasts survive backgrounding.

## Contributing

The shared engine and UI live in `unstation-desktop` — most changes belong there and arrive here for free. For Android-specific work: `ui/` holds the mobile shims (CSS/JS injected over the shared tree), `src-tauri/gen/android/.../io/parity/unstation/android/` the Kotlin. CI builds the frontend against the shared tree on every PR to catch drift.

## License

[AGPL-3.0-or-later](LICENSE), same as the desktop app whose code it embeds.
