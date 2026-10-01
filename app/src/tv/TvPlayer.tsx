import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mediaUrl } from "../api/client";
import { livePosition, startPosition, stillFinishing, useExclusiveAudio } from "../listener/lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../shared/duckEngine";
import { useChannelLog } from "../shared/analytics";
import { radioSessionInfo, useMediaSession } from "../shared/mediaSession";
import { useStationLog } from "../listener/lib/useStationLog";
import { fadeIn, useRewind } from "../listener/lib/useRewind";
import { nativeBridge } from "./nativeBridge";

/**
 * The TV's one radio player (handoff_tv_firetv.md §A5). It owns the <audio>
 * element and lives above every TV screen, so the station keeps playing on
 * Home, What's on, the shout-out screen and Lean back.
 *
 * Composed from exactly the hooks the site's players use (useStationLog,
 * the live-join rule, useOverlayJingles, useExclusiveAudio, useMediaSession,
 * useRewind), in the same way as NowPlayingBar - read that file for the why
 * behind each step. Play always joins the station live (3bce0de).
 */

const LAST_CHANNEL_KEY = "we-are-radio:tv-channel";

export function lastTvChannel(): string | null {
  try {
    return localStorage.getItem(LAST_CHANNEL_KEY);
  } catch {
    return null;
  }
}

interface TvPlayerState {
  slug: string;
  /** What the screens show: while replaying (Start over), now_playing stays the replayed song. */
  data: any;
  playing: boolean;
  unreachable: boolean;
  audioRef: React.RefObject<HTMLAudioElement>;
  /** Switch the audio to another channel, live; keeps playing if it was. */
  tune: (slug: string, opts?: { play?: boolean }) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  canStartOver: boolean;
  startOver: () => void;
  rewound: boolean;
  behindSeconds: number;
  backToLive: () => void;
}

const Ctx = createContext<TvPlayerState | null>(null);

export function useTvPlayer(): TvPlayerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTvPlayer outside TvPlayerProvider");
  return v;
}

export function TvPlayerProvider({ initialSlug, children }: { initialSlug: string; children: ReactNode }) {
  const [slug, setSlug] = useState(initialSlug);
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);
  const heldBack = useRef(false);
  const [loadedItem, setLoadedItem] = useState<any>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const dataRef = useRef<any>(null);
  dataRef.current = data;

  const rw = useRewind({ audioRef, channelSlug: slug, channelId: data?.channel?.id ?? null, loadedItem, playing, castingHere: false });
  const lastOnAir = useRef<any>(null);
  if (data?.on_air) lastOnAir.current = data;
  const shown = useMemo(
    () =>
      rw.rewound
        ? { ...(data?.on_air ? data : lastOnAir.current), on_air: true, now_playing: rw.rewound.item, on_air_now: data?.on_air ? data.now_playing : null }
        : data,
    [data, rw.rewound]
  );
  const rejoinFade = useRef(false);

  useChannelLog(audioRef, shown, playing);
  useExclusiveAudio("tv", audioRef, !!(shown && shown.on_air), () => setPlaying(false));
  useOverlayJingles(audioRef, rw.rewound ? { ...loadedItem, overlays: undefined } : loadedItem, !!(shown && shown.on_air));

  const { refresh } = useStationLog({
    channelSlug: slug,
    pollMs: 15_000,
    playing,
    audioRef,
    loadedItem,
    setData,
    setUnreachable,
    earlyEndFade: !rw.rewound,
  });

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void unlockAudio(audio);
    // While replaying, Play resumes the replay; only Back to live returns to the station.
    if (rw.rewoundRef.current) {
      audio.play().catch(() => {});
      setPlaying(true);
      return;
    }
    const d = dataRef.current;
    if (d?.now_playing && currentItemId.current === d.now_playing.id) {
      const pos = livePosition(d);
      if (pos === null) {
        currentItemId.current = null;
        setPlaying(true);
        void refresh();
        return;
      }
      if (Math.abs(audio.currentTime - pos) > 2) audio.currentTime = pos;
    }
    audio.play().catch(() => {});
    setPlaying(true);
  }, [refresh, rw.rewoundRef]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [play, pause]);

  const backToLive = useCallback(() => {
    const audio = audioRef.current;
    const was = rw.rewoundRef.current;
    rw.clear();
    if (!audio) return;
    const d = dataRef.current;
    if (was && d?.now_playing?.id === was.airingId) {
      const pos = livePosition(d);
      if (pos !== null) {
        audio.currentTime = pos;
        fadeIn(audio, 1000);
        audio.play().catch(() => {});
        setPlaying(true);
        return;
      }
    }
    currentItemId.current = null;
    heldBack.current = true;
    rejoinFade.current = true;
    setPlaying(true);
    void refresh();
  }, [refresh, rw]);

  const tune = useCallback(
    (next: string, opts: { play?: boolean } = {}) => {
      try {
        localStorage.setItem(LAST_CHANNEL_KEY, next);
      } catch {
        /* remembered for this session only */
      }
      const audio = audioRef.current;
      // A gesture (the OK press that got us here) is what lets audio start.
      if (audio && opts.play) void unlockAudio(audio);
      if (next === slug) {
        if (opts.play && !playingRef.current) play();
        return;
      }
      rw.clear();
      audio?.pause();
      setData(null);
      currentItemId.current = null;
      heldBack.current = false;
      setSlug(next);
      // Playing carries over: the new channel's first answer loads and plays.
      if (opts.play) setPlaying(true);
    },
    [slug, play, rw]
  );

  // Lock screen / Fire OS media keys via the Media Session, as in the site's players.
  useMediaSession(audioRef, radioSessionInfo(shown), {
    live: true,
    onPrevious: rw.canStartOver ? () => rw.startOver() : null,
    onPlay: () => play(),
    onPause: () => pause(),
  });

  // Load the on-air item when it changes (see NowPlayingBar for each rule).
  useEffect(() => {
    const item = data?.now_playing;
    const audio = audioRef.current;
    if (!item || !audio) return;
    if (rw.rewoundRef.current) return;
    if (currentItemId.current === item.id) {
      setLoadedItem((l: any) => (l?.id === item.id ? l : item));
      return;
    }
    if (stillFinishing(audio, currentItemId.current !== null)) {
      heldBack.current = true;
      return;
    }
    const followsOn = currentItemId.current !== null;
    currentItemId.current = item.id;
    const waited = heldBack.current;
    heldBack.current = false;
    if (!item.audio_url) return;
    setLoadedItem(item);
    audio.src = mediaUrl(item.audio_url);
    const from = startPosition(item, data.position_seconds ?? 0, waited, followsOn);
    audio.currentTime = from;
    if (rejoinFade.current && from > 0) fadeIn(audio, 1000);
    rejoinFade.current = false;
    if (playingRef.current) audio.play().catch(() => {});
  }, [data, rw.rewoundRef]);

  // Refresh right as the item is due to end, so the screens change with the broadcast.
  useEffect(() => {
    const item = data?.now_playing;
    if (!item?.duration_seconds) return;
    const remaining = item.duration_seconds - (data.position_seconds ?? 0);
    const id = window.setTimeout(() => void refresh(), Math.max(1500, remaining * 1000 + 500));
    return () => window.clearTimeout(id);
  }, [data, refresh]);

  // The Fire TV screen stays on while the station plays (Lean back replaces the screensaver).
  useEffect(() => {
    nativeBridge.keepScreenOn(playing);
  }, [playing]);

  // v1 is foreground only: leaving the app (or the tab) pauses; OK rejoins live.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && playingRef.current) pause();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [pause]);

  const value: TvPlayerState = {
    slug,
    data: shown,
    playing,
    unreachable,
    audioRef,
    tune,
    play,
    pause,
    toggle,
    canStartOver: rw.canStartOver,
    startOver: rw.startOver,
    rewound: !!rw.rewound,
    behindSeconds: rw.behindSeconds,
    backToLive,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio ref={audioRef} onEnded={() => (rw.rewoundRef.current ? backToLive() : void refresh())} />
    </Ctx.Provider>
  );
}
