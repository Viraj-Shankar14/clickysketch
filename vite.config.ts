import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri sets TAURI_DEV_HOST only when developing for a remote device; on desktop it is unset.
const host = process.env.TAURI_DEV_HOST;
const debug = !!process.env.TAURI_ENV_DEBUG;

// The frontend lives in src/ (see spec section 12.2); static assets (fonts) in public/.
export default defineConfig({
  root: "src",
  publicDir: "../public",
  plugins: [react()],
  clearScreen: false, // keep Rust compiler output visible next to Vite's
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // WebView2 is Chromium; WKWebView on the oldest supported macOS is Safari 13.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: debug ? false : "esbuild",
    sourcemap: debug,
  },
});
