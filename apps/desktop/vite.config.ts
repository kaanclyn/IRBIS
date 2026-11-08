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
    // Browser preview (Chrome at :5173) while Electron also runs tile/chart servers.
    proxy: {
      "/navionics": {
        target: "http://127.0.0.1:18765",
        changeOrigin: true,
      },
      "/sonar": {
        target: "http://127.0.0.1:18765",
        changeOrigin: true,
      },
      "/chart-bake": {
        target: "http://127.0.0.1:17357",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/chart-bake/, ""),
      },
      // NMEA / AIS live bridge (Electron webBridgeServer)
      "/api": {
        target: "http://127.0.0.1:18769",
        changeOrigin: true,
      },
    },
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
