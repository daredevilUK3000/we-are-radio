import { useEffect, useRef, type RefObject } from "react";
import { trackPlayerIssue } from "../../shared/analytics";
import { overlayRecent } from "../../shared/duckEngine";

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
 * A pause the player didn't ask for (7 Oct 2026): if it comes while a jingle
 * is talking over the song or just after one ends - phones have paused the
 * music right then - the music is started again straight away. Any other
 * pause is the phone's own (a call, headphones out) and is left alone; the
 * play button then resumes with one tap. Both are reported.
 *
 * Woken up to silence (9 Oct 2026): a phone can freeze the page while it's
 * asleep, and then nothing here can run until the screen comes back on. If
 * the music hadn't moved for a while when the page becomes visible again, it
 * says so ("woke_up_silent", with how long it was hidden and silent and what
 * state the audio was in), so those stops can be told apart from the rest.
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
    /** Where the airing is scheduled to end (seconds into the file): the player pauses there itself. */
    endAt?: number | null;
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

    // A pause nobody here asked for. The player's own pauses (the button, the
    // lock screen, another player starting, recording a shout-out) set it to
    // not-playing first, which ends this effect, so by the time the check runs
    // they're gone; so is a new song's src taking over.
    let pauseCheck: number | undefined;
    let resumedAfterJingle = 0;
    const onPause = () => {
      if (audio.ended) return;
      const jingle = overlayRecent(audio);
      window.clearTimeout(pauseCheck);
      pauseCheck = window.setTimeout(() => {
        const o = latest.current;
        if (!o.active || !audio.paused || audio.ended) return;
        // The scheduled early end: the player paused there on purpose and is loading the next item.
        if (o.endAt && audio.currentTime >= o.endAt - 2) return;
        const detail = { ...audioState(audio), jingle };
        if (jingle && resumedAfterJingle < 3) {
          resumedAfterJingle++;
          trackPlayerIssue("paused_after_jingle", { channelId: o.channelId, label: o.label, detail });
          audio.play().catch(() => o.recover());
        } else {
          trackPlayerIssue("paused_by_phone", { channelId: o.channelId, label: o.label, detail });
        }
      }, 1500);
    };
    audio.addEventListener("pause", onPause);

    let lastProgressAt = Date.now();
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const onProgress = () => {
      if (!audio.paused) lastProgressAt = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const silentS = Math.round((Date.now() - lastProgressAt) / 1000);
      if (hiddenAt !== null && silentS >= 15 && latest.current.active) {
        const o = latest.current;
        trackPlayerIssue("woke_up_silent", {
          channelId: o.channelId,
          label: o.label,
          detail: {
            ...audioState(audio),
            paused: audio.paused,
            ended: audio.ended,
            hidden_s: Math.round((Date.now() - hiddenAt) / 1000),
            silent_s: silentS,
            jingle_before: overlayRecent(audio, silentS * 1000 + 10_000),
          },
        });
      }
      hiddenAt = null;
    };
    audio.addEventListener("timeupdate", onProgress);
    document.addEventListener("visibilitychange", onVisibility);

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
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onProgress);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(pauseCheck);
      window.clearInterval(id);
    };
  }, [audioRef, opts.active]);
}
