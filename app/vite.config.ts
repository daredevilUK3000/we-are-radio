import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Kizzi Radio",
        short_name: "Kizzi Radio",
        description: "Kizzi's personal digital radio network",
        theme_color: "#0b0b0d",
        background_color: "#0b0b0d",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/studio/api": "http://127.0.0.1:8787",
    },
  },
});
