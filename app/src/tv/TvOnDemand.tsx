import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { mediaUrl } from "../api/client";
import { useExclusiveAudio } from "../listener/lib/audioUtils";
import { trackGoodPreview, usePlaySlot, type PlayInfo } from "../shared/analytics";
import { nativeBridge } from "./nativeBridge";
import { useTvPlayer } from "./TvPlayer";

/**
 * On-demand listening on the TV (9 Oct 2026): an Advertising For Good ad, a
 * Radio That Knows You mix, the featured album, a Top 3 song or a podcast
 * episode, picked from Home and played on the "playing now" screen.
 *
 * It has its own <audio>, so the station's player (TvPlayer) and its log are
 * never touched: starting something here pauses the radio (the station steps
 * aside through useExclusiveAudio, as on the site), and stopping - or the
 * last item ending - presses play on the radio again if it was playing, which
 * rejoins it live.
 */

export interface OnDemandItem {
  id: string;
  title: string;
  subtitle?: string | null;
  audio_url: string;
  duration_seconds?: number | null;
  artwork_url?: string | null;
  /** Counted like the site's plays (album, mood mix, podcast); null for things that aren't station content. */
  analytics?: PlayInfo | null;
  /** An Advertising For Good ad: counted as a preview, never as a play. */
  goodId?: string | null;
  /** The song's spoken intro (migrations/0030, "before the song"): played first, then the song. */
  intro?: { audio_url: string; duration_seconds: number } | null;
}

export interface OnDemandQueue {
  /** What the screen says this is: "From the album · Anthem", "Advertising For Good"... */
  eyebrow: string;
  kind: "good" | "mood" | "album" | "top3" | "podcast";
  items: OnDemandItem[];
}

interface OnDemandState {
  queue: OnDemandQueue | null;
  index: number;
  item: OnDemandItem | null;
  playing: boolean;
  /** True while the item's intro plays ahead of it. */
  inIntro: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  start: (queue: OnDemandQueue, startIndex?: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** Stop and give the TV back to the radio (playing again if it was). */
  stop: () => void;
}

const Ctx = createContext<OnDemandState | null>(null);

export function useOnDemand(): OnDemandState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOnDemand outside OnDemandProvider");
  return v;
}

export function OnDemandProvider({ children }: { children: ReactNode }) {
  const player = useTvPlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<OnDemandQueue | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inIntro, setInIntroState] = useState(false);
  // Read by the <audio> events, which can fire before the next render.
  const inIntroRef = useRef(false);
  const setInIntro = (v: boolean) => {
    inIntroRef.current = v;
    setInIntroState(v);
  };
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const indexRef = useRef(index);
  indexRef.current = index;
  // The radio was playing when this began: it plays again when this ends.
  const resumeRadio = useRef(false);
  const slot = usePlaySlot();

  // The radio starting again (Listen on a channel, its own Play) takes over: this stops for good.
  useExclusiveAudio("tv-on-demand", audioRef, !!queue, () => {
    resumeRadio.current = false;
    slot.abandon();
    setQueue(null);
    setPlaying(false);
  });

  const playSrc = (audio: HTMLAudioElement, url: string) => {
    audio.src = mediaUrl(url);
    audio.currentTime = 0;
    audio.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    );
  };

  // The song itself (after its intro, if it has one).
  const playSong = useCallback(
    (it: OnDemandItem) => {
      const audio = audioRef.current;
      if (!audio) return;
      setInIntro(false);
      playSrc(audio, it.audio_url);
      if (it.analytics) slot.start(it.analytics, audio);
      else slot.abandon();
      if (it.goodId) trackGoodPreview(it.goodId);
    },
    [slot]
  );

  const playIndex = useCallback(
    (q: OnDemandQueue, i: number) => {
      const audio = audioRef.current;
      const it = q.items[i];
      if (!audio || !it) return;
      setIndex(i);
      if (it.intro?.audio_url) {
        slot.abandon();
        setInIntro(true);
        playSrc(audio, it.intro.audio_url);
        return;
      }
      playSong(it);
    },
    [slot, playSong]
  );

  const finish = useCallback(() => {
    const audio = audioRef.current;
    slot.abandon();
    audio?.pause();
    audio?.removeAttribute("src");
    setQueue(null);
    setPlaying(false);
    setInIntro(false);
    setIndex(0);
    const resume = resumeRadio.current;
    resumeRadio.current = false;
    if (resume) playerRef.current.play();
    else nativeBridge.keepScreenOn(false);
  }, [slot]);

  const start = useCallback(
    (q: OnDemandQueue, startIndex = 0) => {
      if (q.items.length === 0) return;
      // Only the first start of a session remembers the radio; picking another track keeps that memory.
      if (!queueRef.current) resumeRadio.current = playerRef.current.playing;
      if (playerRef.current.playing) playerRef.current.pause();
      setQueue(q);
      playIndex(q, Math.min(Math.max(0, startIndex), q.items.length - 1));
    },
    [playIndex]
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !queueRef.current) return;
    if (audio.paused) audio.play().then(() => setPlaying(true), () => setPlaying(false));
    else {
      audio.pause();
      setPlaying(false);
    }
  }, []);

  const next = useCallback(() => {
    const q = queueRef.current;
    if (!q) return;
    if (indexRef.current + 1 < q.items.length) playIndex(q, indexRef.current + 1);
    else finish();
  }, [playIndex, finish]);

  const previous = useCallback(() => {
    const q = queueRef.current;
    const audio = audioRef.current;
    if (!q || !audio) return;
    // A few seconds in, Previous restarts this one (as on any music player).
    if (audio.currentTime > 4 || indexRef.current === 0) {
      audio.currentTime = 0;
      if (audio.paused) toggle();
      return;
    }
    playIndex(q, indexRef.current - 1);
  }, [playIndex, toggle]);

  useEffect(() => {
    if (queue) nativeBridge.keepScreenOn(playing);
  }, [queue, playing]);

  const onEnded = () => {
    const it = queueRef.current?.items[indexRef.current];
    if (inIntroRef.current && it) {
      playSong(it);
      return;
    }
    slot.complete();
    next();
  };

  // An intro that won't load mustn't hold up its song.
  const onError = () => {
    const it = queueRef.current?.items[indexRef.current];
    if (inIntroRef.current && it) playSong(it);
  };

  const value: OnDemandState = {
    queue,
    index,
    item: queue?.items[index] ?? null,
    playing,
    inIntro,
    audioRef,
    start,
    toggle,
    next,
    previous,
    stop: finish,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={audioRef} onEnded={onEnded} onError={onError} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
    </Ctx.Provider>
  );
}
