import { useEffect, useRef } from "react";

/**
 * While a listener records (or plays back) a voice note, the station must be
 * quiet, or the speaker bleeds into the microphone. The recorder announces
 * it with a "war:recording" event; each radio player pauses through its own
 * pause path if it was playing, and plays live again afterwards only if it
 * paused for this.
 *
 * Dispatched synchronously from the listener's taps where possible, so the
 * resume still counts as part of their gesture on iOS.
 */
export function announceRecording(active: boolean) {
  window.dispatchEvent(new CustomEvent("war:recording", { detail: { active } }));
}

export function usePauseForRecording(opts: {
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    let pausedByUs = false;
    const on = (e: Event) => {
      const active = !!(e as CustomEvent).detail?.active;
      if (active) {
        if (!pausedByUs && ref.current.isPlaying()) {
          pausedByUs = true;
          ref.current.pause();
        }
      } else if (pausedByUs) {
        pausedByUs = false;
        ref.current.resume();
      }
    };
    window.addEventListener("war:recording", on);
    return () => window.removeEventListener("war:recording", on);
  }, []);
}
