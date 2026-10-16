import { defineConfig, type Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import type { Declaration, Plugin as PostcssPlugin, Rule } from "postcss";

/**
 * The TV app for older TV browsers (handoff_lg_webos.md): the same source as
 * /tv, built a second time into dist/tv-legacy/ after the site's own build
 * (`npm run build`). It runs on Chromium 53, which LG webOS 4.x TVs (2018-19)
 * have. The site's own build is untouched; this only adds files.
 *
 * - Scripts: @vitejs/plugin-legacy turns the code into old-style scripts
 *   (Chromium 53 has no module scripts) and adds the missing built-ins.
 * - Styles: oldTvCss() below rewrites what Chromium 53 doesn't know, and
 *   src/tv/legacy/legacy.css covers the rest by hand.
 */

const TARGET = "chrome >= 53";

/** The sides of a 1-4 value shorthand, as top/right/bottom/left. */
function sides(value: string): [string, string, string, string] {
  const v = value.trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = v;
  return [t, r, b, l];
}

/**
 * Rewrites for Chromium 53, applied only to this build's CSS:
 * - inset -> top/right/bottom/left;
 * - display: grid + place-items: center (every grid on the TV centres one
 *   thing) -> the same with flexbox;
 * - flexbox gap (Chromium 84+) -> a margin between neighbouring children
 *   (a gap beside bare text, like an icon next to a label, is in legacy.css);
 * - `.tv :where(button)` (zero specificity, Chromium 88+) -> plain `button`
 *   (the lowest specificity available), so each button's own rules still win.
 */
function oldTvCss(): PostcssPlugin {
  return {
    postcssPlugin: "old-tv-css",
    Rule(rule: Rule) {
      if (rule.parent?.type === "atrule" && /keyframes/i.test((rule.parent as { name?: string }).name ?? "")) return;
      rule.selector = rule.selector.replace(/\.tv :where\(button\)/g, "button");

      const decls = (rule.nodes ?? []).filter((n): n is Declaration => n.type === "decl");
      const get = (prop: string) => decls.find((d) => d.prop === prop);

      for (const d of decls) {
        if (d.prop === "inset") {
          const [t, r, b, l] = sides(d.value);
          d.cloneBefore({ prop: "top", value: t });
          d.cloneBefore({ prop: "right", value: r });
          d.cloneBefore({ prop: "bottom", value: b });
          d.cloneBefore({ prop: "left", value: l });
          d.remove();
        }
      }

      const display = get("display");
      const place = get("place-items");
      if (display?.value === "grid" && place?.value === "center") {
        display.value = "flex";
        place.cloneBefore({ prop: "align-items", value: "center" });
        place.cloneBefore({ prop: "justify-content", value: "center" });
        place.remove();
      }

      const gap = get("gap");
      if (gap && get("display")?.value.includes("flex")) {
        const [rowGap, colGap = rowGap] = gap.value.trim().split(/\s+/);
        const column = /column/.test(get("flex-direction")?.value ?? "");
        const margin = column ? { prop: "margin-top", value: rowGap } : { prop: "margin-left", value: colGap };
        // :not(#_) lifts the rule above the children's own margin resets (margin: 0 on headings and the like).
        const between = rule.selectors.map((s) => `${s} > :not(#_) + *`).join(",\n");
        if (!rule.parent) return;
        const extra = rule.clone({ selector: between, nodes: [] });
        extra.append(margin);
        rule.after(extra);
        gap.remove();
      }
    },
  };
}
oldTvCss.postcss = true;

/** Leaves the site's own files alone: only the legacy page and its assets are written. */
function onlyLegacyOutput(): VitePlugin {
  return {
    name: "war-tv-legacy-only",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (!name.startsWith("tv-legacy/")) delete bundle[name];
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: [TARGET],
      renderModernChunks: false,
    }),
    onlyLegacyOutput(),
  ],
  // public/ is already copied by the site's own build.
  publicDir: false,
  css: {
    postcss: { plugins: [oldTvCss()] },
  },
  build: {
    outDir: "dist",
    // The site's build has just written dist/; this adds dist/tv-legacy/ beside it.
    emptyOutDir: false,
    assetsDir: "tv-legacy/assets",
    cssTarget: "chrome53",
    rollupOptions: {
      input: "tv-legacy/index.html",
    },
  },
});
