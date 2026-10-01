import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { trackRestart } from "../../shared/analytics";
import { useContestStateShared } from "../components/contest/common";

/**
 * "Start over" (handoff_player_upgrades.md §1), shared by both radio players
 * (NowPlayingBar with NowPlayingExpanded, and Listen).
 *
 * One tap restarts the song already in the <audio> element from 0:00, for this
 * listener only: no reload (the same source seeks with Range), a 300 ms fade-in.
 * The player is then "rewound" for that airing:
 * - it ignores the station moving on (polls carry on, so Coming up stays
 *   current, but nothing new loads until the replay ends);
 * - no scheduled early-end fade, and overlay jingles don't fire again;
 * - Pause and Play resume the replay, not live;
 * - "Back to live" (or the replay ending) rejoins the station by the same rule
 *   as after letting a song finish (from the top if <= 15 s in, else live).
 * The players own the <audio> element and their load path; this hook only
 * holds the state and the rules for when the button shows.
 */

export const START_OVER_MIN_SECONDS = 10;
const FADE_IN_MS = 300;

export interface Rewound {
  /** The airing being replayed (now_playing.id when it was restarted). */
  airingId: string;
  channelSlug: string;
  /** The item in the <audio> element: what the player keeps showing while rewound. */
  item: any;
  /** Wall-clock second at which the station was at 0:00 of this airing; "behind" counts from it. */
  anchorSec: number;
}

/** Ramps the element's volume up from silence. Timers, not animation frames, so it finishes with the screen off. */
export function fadeIn(audio: HTMLAudioElement, ms: number) {
  const start = Date.now();
  audio.volume = 0;
  const step = () => {
    const k = Math.min(1, (Date.now() - start) / ms);
    audio.volume = k;
    if (k < 1) window.setTimeout(step, 30);
  };
  window.setTimeout(step, 30);
  // Belt and braces: whatever the timers did, end at full volume.
  window.setTimeout(() => (audio.volume = 1), ms + 400);
}

export function useRewind({
  audioRef,
  channelSlug,
  channelId,
  loadedItem,
  playing,
  castingHere,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  channelSlug: string;
  channelId: string | null;
  /** The item actually in the <audio> element. */
  loadedItem: any;
  playing: boolean;
  castingHere: boolean;
}) {
  const [rewound, setRewound] = useState<Rewound | null>(null);
  // Read synchronously by the players' load path, which runs before a re-render.
  const rewoundRef = useRef<Rewound | null>(null);
  rewoundRef.current = rewound;

  const clear = useCallback(() => {
    rewoundRef.current = null;
    setRewound(null);
  }, []);

  // Per channel: switching channels clears it (the player then plays the new channel live).
  useEffect(() => {
    if (rewoundRef.current && rewoundRef.current.channelSlug !== channelSlug) clear();
  }, [channelSlug, clear]);
  // Casting starts: the cast plays live, as always.
  useEffect(() => {
    if (castingHere && rewoundRef.current) clear();
  }, [castingHere, clear]);

  // At least 10 s in? Tracked from the element, so the button appears without waiting for a poll.
  const [pastMin, setPastMin] = useState(false);
  const [behind, setBehind] = useState(0);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPastMin(audio.currentTime >= START_OVER_MIN_SECONDS);
    onTime();
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("seeked", onTime);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("seeked", onTime);
    };
  }, [audioRef, loadedItem?.id]);

  // "2:41 behind": how far the listener is behind the station, ticking while paused too.
  useEffect(() => {
    if (!rewound) return;
    const tick = () => {
      const audio = audioRef.current;
      setBehind(Math.max(0, Date.now() / 1000 - rewound.anchorSec - (audio?.currentTime ?? 0)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [rewound, audioRef]);

  // Top 3 voting: no Start over on contest entries, so extra listens can't be made on air.
  const { state: contest } = useContestStateShared();
  const voting = contest?.phase === "voting";

  const item = rewound?.item ?? loadedItem;
  const canStartOver =
    !!item &&
    item.item_type === "song" &&
    playing &&
    pastMin &&
    !castingHere &&
    !(voting && item.is_contest_entry);

  const startOver = useCallback(() => {
    const audio = audioRef.current;
    const current = rewoundRef.current?.item ?? loadedItem;
    if (!audio || !current) return;
    const secondsIn = audio.currentTime;
    // Starting over again during a replay keeps the original anchor: "behind" just grows.
    const next: Rewound = rewoundRef.current ?? {
      airingId: current.id,
      channelSlug,
      item: current,
      anchorSec: Date.now() / 1000 - secondsIn,
    };
    rewoundRef.current = next;
    setRewound(next);
    audio.currentTime = 0;
    fadeIn(audio, FADE_IN_MS);
    setPastMin(false);
    if (channelId && current.track_id) trackRestart(channelId, current.track_id, secondsIn);
  }, [audioRef, loadedItem, channelSlug, channelId]);

  return { rewound, rewoundRef, canStartOver, startOver, clear, behindSeconds: behind };
}

/** "2:41" */
export function behindLabel(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
