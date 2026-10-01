import { useEffect, useRef } from "react";
import type { MediaKey } from "./nativeBridge";

/**
 * The TV's global keys (handoff_tv_firetv.md §A2): Back, the media keys and
 * Menu, from the keyboard in a TV browser (and desktop testing) or from the
 * Fire TV shell through the bridge. Arrows and OK are left to the spatial
 * navigation library, which has its own listener; this hook never handles them.
 *
 * Desktop: Esc / Backspace = Back, Space = Play/Pause, r = Start over,
 * f = Back to live, m = What's on.
 */

const BACK_KEYS = new Set(["Escape", "Backspace", "GoBack", "BrowserBack"]);

export function keyToMedia(e: KeyboardEvent): MediaKey | null {
  switch (e.key) {
    case "MediaPlayPause":
    case " ":
      return "playpause";
    case "MediaPlay":
      return "play";
    case "MediaPause":
      return "pause";
    case "MediaRewind":
    case "r":
      return "rewind";
    case "MediaFastForward":
    case "f":
      return "fastforward";
    case "ContextMenu":
    case "m":
      return "menu";
  }
  switch (e.keyCode) {
    case 179:
      return "playpause";
    case 227:
      return "rewind";
    case 228:
      return "fastforward";
    case 93:
      return "menu";
  }
  return null;
}

export function useTvKeys(handlers: {
  /** Any key at all, before anything else; return true to swallow it (Lean back waking). */
  onAnyKey: (e: KeyboardEvent) => boolean;
  onBack: () => void;
  onMedia: (key: MediaKey) => void;
}) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing never happens on TV, but don't steal keys from a text field if one ever exists.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (ref.current.onAnyKey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (BACK_KEYS.has(e.key) || e.keyCode === 10009 || e.keyCode === 461) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ref.current.onBack();
        return;
      }
      const media = keyToMedia(e);
      if (media) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ref.current.onMedia(media);
      }
    };
    // Capture phase on window: runs before the spatial navigation's own listener.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
