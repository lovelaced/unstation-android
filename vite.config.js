import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import fs from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
// SINGLE-SOURCE THE FRONTEND: the Vite root IS the desktop app's src/ tree, so
// index.html / main.js / sso.js / styles / tauri.js / ambient.js / health.js / wasm-compat.js
// are shared verbatim (no copies → the JS↔Rust contract can't drift). Android-only tweaks
// (hls.js playback, the polkadotapp:// deep-link, hiding the titlebar) are injected via
// ui/android-shims.js at M2/M3 — not by editing the shared tree.
const desktopRepo = resolve(here, "../unstation-desktop");
const desktopSrc = resolve(desktopRepo, "desktop/src");

// Same pre-transform as desktop: the sr25519 slot-signer wasm initializes via
// `new URL("data:application/wasm;base64,…", import.meta.url)`; Vite's asset-import-meta-url
// transform would resolve that data: URL as a file path. Drop the base so the data: URL
// survives for wasm-compat.js to decode.
const fixWasmDataUrl = {
  name: "unstation-wasm-dataurl-fix",
  enforce: "pre",
  transform(code, id) {
    if (id.includes("substrate-slot-sr25519-wasm") && code.includes("import.meta.url")) {
      return { code: code.replace(/,\s*import\.meta\.url\s*\)/g, ")"), map: null };
    }
  },
};

// Inject the Android-only shim (ui/android-shims.js) before the shared main.js WITHOUT
// editing the shared index.html/main.js. Served as a virtual module so the shim's own
// imports (e.g. hls.js at M3) resolve + bundle normally from this repo's node_modules.
const shimPath = resolve(here, "ui/android-shims.js");
const cssPath = resolve(here, "ui/android.css");
const hlsPath = resolve(here, "node_modules/hls.js/dist/hls.min.js");
const androidShims = {
  name: "unstation-android-shims",
  transformIndexHtml() {
    // Everything is injected INLINE: an injected `<script src="virtual:...">` / asset ref is
    // NOT reliably picked up as a build entry by Vite, so it never loads. Inlining runs in both
    // dev and build. hls.js is a CLASSIC script (sets window.Hls, executes during parse — before
    // the deferred module scripts incl. the shim + main.js). The shim is a module that uses
    // window.Hls + window.__TAURI__ (no npm imports, so inlining suffices).
    return [
      { tag: "script", children: fs.readFileSync(hlsPath, "utf8"), injectTo: "head-prepend" },
      { tag: "style", children: fs.readFileSync(cssPath, "utf8"), injectTo: "head" },
      { tag: "script", attrs: { type: "module" }, children: fs.readFileSync(shimPath, "utf8"), injectTo: "head-prepend" },
    ];
  },
};

export default defineConfig({
  plugins: [fixWasmDataUrl, androidShims],
  root: desktopSrc,
  base: "./",
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    target: "esnext",
  },
  server: {
    port: 1420,
    strictPort: true,
    // Allow serving the shared desktop tree (root) + this repo (node_modules, ui/).
    fs: { allow: [desktopRepo, here] },
  },
  optimizeDeps: {
    exclude: ["@novasamatech/substrate-slot-sr25519-wasm"],
  },
  clearScreen: false,
});
