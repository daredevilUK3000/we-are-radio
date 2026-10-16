import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "../../styles/global.css";
import TvApp from "../TvApp";
import "./legacy.css";

/**
 * We Are Radio on TV for older TV browsers (handoff_lg_webos.md): the same TV
 * app as /tv (src/tv), built a second time by vite.tv-legacy.config.ts for
 * Chromium 53 - LG webOS 4.x, the oldest LG TVs the LG app supports - and
 * served at /tv-legacy/. /tv sends any browser too old for the site's own
 * build here (the check in index.html), so the LG app simply opens /tv.
 *
 * Only the build differs: old-style scripts with the missing features added
 * (@vitejs/plugin-legacy), CSS rewritten for old engines, and legacy.css.
 */

// The TV app's screens live under /tv/... index.html's check sends a reload
// anywhere under /tv back here with the screen's path after the #.
const path = /^#\/tv(\/[\w\/-]*)?$/.test(window.location.hash) ? window.location.hash.slice(1) : "/tv";
window.history.replaceState(null, "", path + window.location.search);

// Old engines can't focus without scrolling (focus's preventScroll is Chromium 64+),
// so focusing a card at the edge of a clipped row would scroll it out of line.
// Nothing on the TV scrolls by design: undo any scroll the moment it happens.
document.addEventListener(
  "scroll",
  (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && (el.scrollTop || el.scrollLeft)) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  },
  true
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/tv/*" element={<TvApp />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
