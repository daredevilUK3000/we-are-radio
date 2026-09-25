import { useSyncExternalStore } from "react";
import { isIOS } from "./offline";

/**
 * "Install the app". Android Chrome (and desktop Chrome/Edge) offer their own
 * install dialog: the browser fires beforeinstallprompt once the site
 * qualifies, and we keep it to open from our own button. iPhones have no such
 * dialog - there we show how to use Safari's "Add to Home Screen" instead.
 *
 * The event can fire before React has drawn anything, so it's caught as soon
 * as this module loads (main.tsx imports it).
 */

interface InstallState {
  /** The browser's install dialog is ready to open. */
  canPrompt: boolean;
  /** Already running as an installed app. */
  installed: boolean;
}

let deferred: any = null;
let state: InstallState = { canPrompt: false, installed: false };
const subscribers = new Set<() => void>();

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

function standalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

if (typeof window !== "undefined") {
  state = { canPrompt: false, installed: standalone() };
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our button instead of the browser's mini-bar
    deferred = e;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canPrompt: false, installed: true });
  });
}

export function useInstall(): InstallState & { iosSafari: boolean } {
  const s = useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
    () => state
  );
  // Only Safari on an iPhone/iPad can add a web app to the home screen
  // (Chrome on iPhone can too since iOS 16.4, via its own share menu).
  return { ...s, iosSafari: isIOS() && !s.installed };
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const event = deferred;
  deferred = null;
  set({ canPrompt: false });
  event.prompt();
  await event.userChoice.catch(() => null);
}
