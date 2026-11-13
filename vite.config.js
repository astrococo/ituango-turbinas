import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": rutas relativas, para servir desde GitHub Pages (astrococo.github.io/ituango-turbinas/)
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { uplot: ["uplot"] } } },
  },
});
