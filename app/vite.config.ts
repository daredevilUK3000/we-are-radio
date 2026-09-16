import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No PWA/service-worker plugin: a workbox-generated service worker was
// intercepting navigation requests and breaking the site (ERR_FAILED /
// "site can't be reached") for real visitors after a deploy changed the
// asset hashes underneath it. See public/sw.js for the self-unregistering
// worker that cleans up anyone who already has the old one installed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/studio/api": "http://127.0.0.1:8787",
    },
  },
});
