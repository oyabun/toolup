import { defineConfig } from "vite";

// The window's interface. Tauri loads it from the dev server while developing and from dist/ once built.
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "0.0.0.0", fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
