import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

export default defineConfig({
  plugins: [fixWasmDataUrl],
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
