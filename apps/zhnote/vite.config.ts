/// <reference types="vitest" />

import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type UserConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

const stripCrossOrigin: Plugin = {
  name: "strip-crossorigin",
  transformIndexHtml(html) {
    return html.replace(/ crossorigin(="")?/g, "");
  },
};

export default defineConfig(() => ({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
    lingui(),
    babel({
      presets: [linguiTransformerBabelPreset()],
    }),
    tailwindcss(),
    stripCrossOrigin,
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    reporters: "default",
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/src-tauri/**"],
  },
  ...tauri,
}));

const tauri: UserConfig = {
  clearScreen: false,
  server: {
    port: 1530,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1531 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  base: "./",
  build: {
    outDir: "./dist",
    chunkSizeWarningLimit: 500 * 10,
    target:
      process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    modulePreload: false,
  },
};
