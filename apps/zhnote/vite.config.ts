/// <reference types="vitest" />

import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type UserConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: false }),
    react(),
    lingui(),
    tailwindcss(),
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
    hmr: host
      ? { protocol: "ws", host, port: 1531 }
      : undefined,
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
  },
};
