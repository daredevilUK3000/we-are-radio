/**
 * The contract between /tv and the TV apps (handoff_tv_firetv.md §A9,
 * handoff_lg_webos.md §2.3). Only active with ?shell=firetv or ?shell=webos;
 * in any other TV browser every call is a no-op and the page behaves as an
 * ordinary web page.
 *
 * Fire TV: page -> native is window.WeAreRadioNative (an Android
 * @JavascriptInterface); native -> page is window.weAreRadioTv.back() /
 * .media(name), registered here.
 *
 * LG (webOS): the app is a hosted web app (tv/webos), so this page is the
 * app's own window. Its remote keys arrive as ordinary keydowns (useTvKeys),
 * and the few native calls go to LG's PalmSystem object instead.
 */

export type MediaKey = "playpause" | "play" | "pause" | "rewind" | "fastforward" | "menu";

interface NativeShell {
  keepScreenOn?: (on: boolean) => void;
  exitApp?: () => void;
  shellReady?: () => void;
  log?: (level: string, message: string) => void;
}

declare global {
  interface Window {
    WeAreRadioNative?: NativeShell;
    weAreRadioTv?: { back: () => "handled" | "exit"; media: (name: string) => void };
  }
}

// Read once and kept for the session: later in-app navigation drops the query string.
const initialShell = (() => {
  try {
    return new URLSearchParams(window.location.search).get("shell");
  } catch {
    return null;
  }
})();
let shell: string | null = initialShell;
try {
  if (shell) sessionStorage.setItem("tv-shell", shell);
  else shell = sessionStorage.getItem("tv-shell");
} catch {
  /* storage blocked: the query string alone decides */
}

export const isFireTvShell = () => shell === "firetv";
export const isWebOsShell = () => shell === "webos";
export const tvPlatform = (): "firetv" | "webos" | "tv" => (isFireTvShell() ? "firetv" : isWebOsShell() ? "webos" : "tv");

// The LG app's side: only exit. webOS has no way to keep the screen on for
// audio (only full-screen video holds off its screensaver), and there's no
// native splash or log to talk to, so the other calls stay no-ops.
const webOsShell: NativeShell = {
  // Back on Home: LG's own exit (the Home screen, or its exit question on some versions).
  exitApp() {
    const w = window as Window & { webOS?: { platformBack?: () => void }; PalmSystem?: { platformBack?: () => void } };
    if (w.webOS?.platformBack) w.webOS.platformBack();
    else if (w.PalmSystem?.platformBack) w.PalmSystem.platformBack();
    else window.close();
  },
};

const native = (): NativeShell | undefined => (isFireTvShell() ? window.WeAreRadioNative : isWebOsShell() ? webOsShell : undefined);

export const nativeBridge = {
  keepScreenOn(on: boolean) {
    try {
      native()?.keepScreenOn?.(on);
    } catch {
      /* the shell is optional */
    }
  },
  exitApp() {
    try {
      native()?.exitApp?.();
    } catch {
      /* nothing to exit to in a browser */
    }
  },
  shellReady() {
    try {
      native()?.shellReady?.();
    } catch {
      /* ignore */
    }
  },
  log(level: "info" | "warn" | "error", message: string) {
    try {
      native()?.log?.(level, message);
    } catch {
      /* ignore */
    }
  },
};

/** Registers the page's side of the bridge; returns the cleanup. */
export function registerPageBridge(handlers: { back: () => "handled" | "exit"; media: (name: MediaKey) => void }) {
  window.weAreRadioTv = {
    back: () => {
      try {
        return handlers.back();
      } catch {
        // Never trap the user: if the page can't decide, the shell exits.
        return "exit";
      }
    },
    media: (name: string) => {
      if (["playpause", "play", "pause", "rewind", "fastforward", "menu"].includes(name)) handlers.media(name as MediaKey);
    },
  };
  return () => {
    delete window.weAreRadioTv;
  };
}
