import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in dev: the browser only talks to :5173, so cookies are first-party.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
