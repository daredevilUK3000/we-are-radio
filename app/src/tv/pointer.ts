import { navigateByDirection } from "@noriginmedia/norigin-spatial-navigation";
import { isWebOsShell } from "./nativeBridge";

/**
 * The LG Magic Remote's pointer (handoff_lg_webos.md §2.2), in the LG app only
 * (?shell=webos), so Fire TV and browsers are unaffected:
 *
 * - pointing at an item focuses it, so the arrows carry on from there;
 * - a click acts as OK (every focusable item already has an onClick);
 * - the wheel steps up and down, as the arrows do.
 *
 * Nothing here is needed to use the app: the arrows and OK are always enough.
 */
export const pointerEnabled = () => isWebOsShell();

let lastX = -1;
let lastY = -1;
// Whether the last mousemove was the pointer really moving. A row sliding under
// a still pointer also fires mouse events, and focusing on those would make the
// row run away along the cards.
let realMove = false;

/** Return true to swallow the click or wheel step (it only woke Lean back). */
type ActivityListener = () => boolean;
const listeners: ActivityListener[] = [];

/** Any pointer use (a real move, a click, the wheel): wakes Lean back the way a key does. */
export function onPointerActivity(fn: ActivityListener) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
const activity = () => listeners.reduce((swallow, fn) => fn() || swallow, false);

let installed = false;

export function installPointer() {
  if (installed || !pointerEnabled()) return;
  installed = true;
  document.documentElement.classList.add("tv-pointer");

  window.addEventListener(
    "mousemove",
    (e) => {
      realMove = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) >= 3;
      lastX = e.clientX;
      lastY = e.clientY;
      if (realMove) activity();
    },
    true
  );

  // OK on the Magic Remote in pointer mode is a click. If the same press also
  // arrives as an Enter key (before or after the click), only the first acts.
  let lastEnter = 0;
  let lastClick = 0;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.keyCode !== 13) return;
      if (Date.now() - lastClick < 500) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastEnter = Date.now();
    },
    true
  );
  window.addEventListener(
    "click",
    (e) => {
      if (Date.now() - lastEnter < 500 || activity()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastClick = Date.now();
    },
    true
  );

  let lastWheel = 0;
  window.addEventListener(
    "wheel",
    (e) => {
      const t = Date.now();
      if (!e.deltaY || t - lastWheel < 250) return;
      lastWheel = t;
      if (activity()) return;
      void navigateByDirection(e.deltaY > 0 ? "down" : "up", {});
    },
    { passive: true }
  );
}

/** onMouseMove for a focusable item: pointing at it focuses it (LG app only). */
export function hoverFocus(focused: boolean, focusSelf: () => void): (() => void) | undefined {
  if (!pointerEnabled()) return undefined;
  return () => {
    if (realMove && !focused) focusSelf();
  };
}

/** Whether the mousemove being handled was the pointer really moving (for items that aren't focusables of their own). */
export const pointerMoved = () => realMove;
