import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["rail-icon.svg"],
      manifest: {
        name: "軌語 RailTalk｜平溪線隨行導覽",
        short_name: "RailTalk",
        description: "跟著平溪線移動的離線語音導覽 Demo",
        theme_color: "#173f35",
        background_color: "#f8f4eb",
        display: "standalone",
        start_url: ".",
        scope: ".",
        lang: "zh-Hant",
        icons: [{ src: "rail-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,svg,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html"
      }
    })
  ],
  base: process.env.GITHUB_ACTIONS ? "/AI-rail-guide/" : "/",
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" }
  },
  build: { outDir: "dist-web" }
});
