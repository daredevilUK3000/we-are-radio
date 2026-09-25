import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Small files from public/ that belong to the offline app shell. The videos
// (hero, channel loops, Top 3) are left out - too big to store for everyone.
const SHELL_PUBLIC_FILES = [
  "/manifest.webmanifest",
  "/favicon.svg",
  "/weareradio-logo.webp",
  "/icons/icon-96.png",
  "/icons/icon-192.png",
  "/icons/icon-256.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/channels/channel-kizzi-radio.jpg",
  "/channels/channel-we-are-50s.jpg",
  "/channels/channel-we-are-love.jpg",
  "/channels/channel-we-are-after-dark.jpg",
];

/**
 * Builds dist/sw.js from sw/sw.js, filling in this build's file list and an
 * id that changes whenever any of those files do - which is what makes the
 * browser install the new worker and drop the old build's cached files.
 *
 * (History: a workbox-generated worker once broke navigation for real
 * visitors after a deploy. This one is hand-written and network-first for
 * pages - see sw/sw.js.)
 */
function serviceWorker(): Plugin {
  return {
    name: "war-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((name) => !name.endsWith(".map") && name !== "index.html")
        .map((name) => `/${name}`);
      const precache = ["/", ...built, ...SHELL_PUBLIC_FILES];

      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : Buffer.from(item.source));
      }
      for (const file of SHELL_PUBLIC_FILES) hash.update(readFileSync(resolve(__dirname, "public", file.slice(1))));
      const template = readFileSync(resolve(__dirname, "sw/sw.js"), "utf8");
      hash.update(template);

      const source = template
        .replace("__BUILD_ID__", hash.digest("hex").slice(0, 12))
        .replace("__PRECACHE__", JSON.stringify(precache, null, 2));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/studio/api": "http://127.0.0.1:8787",
    },
  },
});
