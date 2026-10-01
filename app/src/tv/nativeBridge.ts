/**
 * The contract between /tv and the Fire TV app (handoff_tv_firetv.md §A9).
 * Only active with ?shell=firetv; in any other TV browser every call is a
 * no-op and the page behaves as an ordinary web page.
 *
 * Page -> native: window.WeAreRadioNative (an Android @JavascriptInterface).
 * Native -> page: window.weAreRadioTv.back() / .media(name), registered here.
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
export const tvPlatform = (): "firetv" | "tv" => (isFireTvShell() ? "firetv" : "tv");

const native = (): NativeShell | undefined => (isFireTvShell() ? window.WeAreRadioNative : undefined);

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
