# Unstation Android

Tauri v2 Android build of Unstation — decentralized P2P live streaming.

It **reuses the desktop app's Rust core and web frontend** rather than duplicating them:

- `src-tauri/` depends on `../../unstation-desktop/crates/unstation-app` (the shared Tauri
  command/event layer) via a path dependency — so **this repo must sit next to
  `unstation-desktop/` under the same parent directory** (e.g. both under `~/git/`).
- The frontend is single-sourced: `vite.config.js` points Vite's `root` at the desktop app's
  `src/` tree, so `index.html` / `main.js` / `sso.js` / `styles/` are shared verbatim (no copies,
  no drift). Android-only tweaks are injected via `ui/` shims, not by editing the shared tree.

Watch is the current target; camera publishing (the `publish` Cargo feature + a native MediaCodec
capture plugin feeding the existing mesh publisher) is planned.

## Build & run

Requires the Android SDK + NDK (r26+) and a JDK, with `ANDROID_HOME` / `ANDROID_NDK_HOME` /
`JAVA_HOME` set.

```sh
pnpm install
pnpm tauri android init                        # generate gen/android (once)
pnpm tauri android build --debug --target aarch64
# install + launch on a connected device/emulator:
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n io.parity.unstation.android/.MainActivity
```

> **⚠️ `gen/android` is hand-maintained — do NOT re-run `pnpm tauri android init`.**
> The generated tree is committed and carries real, non-regenerable code:
> `CameraPlugin.kt` / `CameraBridge.kt` (camera publish), `PublishForegroundService.kt`
> (backgrounded-broadcast survival), and `AndroidManifest.xml` entries (camera +
> foreground-service permissions, the service declaration, the `polkadotapp://`
> package-visibility query). A regen silently clobbers all of it. If a Tauri upgrade
> requires regenerating, diff the old tree back in by hand.
