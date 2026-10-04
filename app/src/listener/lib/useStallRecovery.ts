import { useEffect, useRef, type RefObject } from "react";
import { trackPlayerIssue } from "../../shared/analytics";

/**
 * Keeps a radio player going when its audio gets stuck (4 Oct 2026).
 *
 * On phones the connection to a song's file can break mid-song - moving from
 * Wi-Fi to mobile data, a weak signal - and the <audio> element then sits
 * silent while the player still shows "playing". Pressing pause and play
 * doesn't help, because the element itself is broken; reopening the file
 * does (which is why switching channel brought it back).
 *
 * So, while the player is meant to be playing:
 * - an "error" on the element, or
 * - the song not moving forward for STUCK_SECONDS (and not seeking)
 * calls `recover`, which reopens what's on air at the live point. At most
 * MAX_RECOVERIES in a row; after that it gives up (quietly, until the song
 * moves again or the listener presses play) rather than loop. Each
 * case is reported (trackPlayerIssue) so the next "it just stopped" can be
 * traced to a cause.
 *
 * A pause the phone makes itself (a call, headphones out) is left alone: the
 * element is paused, not stuck.
 */

const CHECK_MS = 2000;
const STUCK_SECONDS = 8;
const MAX_RECOVERIES = 3;
const RESET_AFTER_MS = 2 * 60_000;

export function audioState(audio: HTMLAudioElement): Record<string, unknown> {
  return {
    readyState: audio.readyState,
    networkState: audio.networkState,
    error: audio.error?.code ?? null,
    at: Math.round(audio.currentTime),
    volume: Math.round(audio.volume * 100) / 100,
    visible: typeof document !== "undefined" ? document.visibilityState : null,
    online: typeof navigator !== "undefined" ? navigator.onLine : null,
  };
}

/** True when the element can't play as it is: reopening the file is the only cure. */
export function isBroken(audio: HTMLAudioElement): boolean {
  return !!audio.error || (audio.networkState === audio.NETWORK_NO_SOURCE && !!audio.src);
}

export function useStallRecovery(
  audioRef: RefObject<HTMLAudioElement>,
  opts: {
    /** Meant to be playing live (not paused, not casting, not replaying a song). */
    active: boolean;
    recover: () => void;
    channelId: string | null;
    label: string | null;
  }
) {
  const latest = useRef(opts);
  latest.current = opts;
  const recoveries = useRef(0);
  const lastRecoveryAt = useRef(0);
  const pendingCheck = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !opts.active) return;

    let lastTime = audio.currentTime;
    let stuckFor = 0;
    // Pressing play (this effect starting again) always earns a fresh set of attempts.
    recoveries.current = 0;
    let gaveUp = false;

    const tryRecover = (kind: "stall" | "error", extra: Record<string, unknown> = {}) => {
      const o = latest.current;
      const now = Date.now();
      if (now - lastRecoveryAt.current > RESET_AFTER_MS) recoveries.current = 0;
      const detail = { ...audioState(audio), ...extra, attempt: recoveries.current + 1 };
      if (recoveries.current >= MAX_RECOVERIES) {
        // Stop trying (and reporting) until the song moves again or the listener presses play.
        gaveUp = true;
        trackPlayerIssue("gave_up", { channelId: o.channelId, label: o.label, detail });
        return;
      }
      trackPlayerIssue(kind, { channelId: o.channelId, label: o.label, detail });
      recoveries.current++;
      lastRecoveryAt.current = now;
      stuckFor = 0;
      // Did it work? Checked once the reopened song has had time to start.
      pendingCheck.current = true;
      o.recover();
    };

    const onError = () => {
      if (!gaveUp) tryRecover("error");
    };
    audio.addEventListener("error", onError);

    const id = window.setInterval(() => {
      const t = audio.currentTime;
      // Playing on its own: a small step forward since the last check. A big jump
      // is a seek (reopening at the live point), not proof that sound is coming out.
      const step = t - lastTime;
      const moving = !audio.paused && !audio.seeking && step > 0 && step <= CHECK_MS / 1000 + 1.5;
      if (moving) {
        gaveUp = false;
        if (pendingCheck.current) {
          pendingCheck.current = false;
          const o = latest.current;
          trackPlayerIssue("recovered", { channelId: o.channelId, label: o.label, detail: audioState(audio) });
        }
        stuckFor = 0;
      } else if (!gaveUp && !audio.paused && !audio.ended && !audio.seeking) {
        stuckFor += CHECK_MS / 1000;
        if (stuckFor >= STUCK_SECONDS) tryRecover("stall", { stuck_s: stuckFor });
      }
      lastTime = t;
    }, CHECK_MS);

    return () => {
      audio.removeEventListener("error", onError);
      window.clearInterval(id);
    };
  }, [audioRef, opts.active]);
}
