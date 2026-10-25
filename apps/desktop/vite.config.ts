import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      "@irbis/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@irbis/connect": path.resolve(__dirname, "../../packages/connect/src/index.ts"),
      "@irbis/charts": path.resolve(__dirname, "../../packages/charts/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    // Don't prebundle maplibre — its worker URL breaks under Vite+Electron.
    exclude: ["maplibre-gl"],
    include: ["pmtiles"],
  },
  worker: {
    format: "es",
  },
});
