import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { init, pause as pauseNav, resume as resumeNav } from "@noriginmedia/norigin-spatial-navigation";
import { setAnalyticsPlatform, trackTv } from "../shared/analytics";
import { nativeBridge, registerPageBridge, tvPlatform, type MediaKey } from "./nativeBridge";
import { lastTvChannel, TvPlayerProvider, useTvPlayer } from "./TvPlayer";
import { TvDataProvider } from "./tvData";
import { useTvKeys } from "./useTvKeys";
import { goBack, UiCtx } from "./tvUi";
import { Home } from "./screens/Home";
import { NowPlaying } from "./screens/NowPlaying";
import { Schedule } from "./screens/Schedule";
import { ShoutOut } from "./screens/ShoutOut";
import { LeanBack } from "./screens/LeanBack";
import { OnDemand } from "./screens/OnDemand";
import { TimeCapsuleQr, Top3Qr } from "./screens/QrInfo";
import { OnDemandProvider, useOnDemand } from "./TvOnDemand";
import "./tv.css";

/**
 * We Are Radio on TV (handoff_tv_firetv.md, Part A): /tv, a lean-back,
 * remote-controlled version of the station for TV browsers and the Fire TV
 * app. Lazy-loaded from App.tsx, outside the site layout, so phones never
 * download it.
 *
 * Everything is designed at 1920x1080 CSS px on a fixed stage, scaled to fit
 * whatever the TV's browser reports (Fire TV WebViews often say 960x540).
 */

const STAGE_W = 1920;
const STAGE_H = 1080;
const IDLE_MS = 2 * 60_000;

// Spatial navigation: arrows and OK. Throttled to one move per 120 ms when a key repeats.
init({ throttle: 120, throttleKeypresses: true, shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true } });


function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const left = (window.innerWidth - STAGE_W * scale) / 2;
  const top = (window.innerHeight - STAGE_H * scale) / 2;
  return (
    <div className="tv-letterbox">
      <div className="tv tv-stage" style={{ transform: `translate(${Math.max(0, left)}px, ${Math.max(0, top)}px) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function TvShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const player = useTvPlayer();
  const od = useOnDemand();
  const odRef = useRef(od);
  odRef.current = od;
  const [leanBack, setLeanBack] = useState(false);
  const lastKey = useRef(Date.now());
  const leanRef = useRef(leanBack);
  leanRef.current = leanBack;
  const playerRef = useRef(player);
  playerRef.current = player;

  // Slow hardware: no deviceMemory over 1 GB, or a hero video that took over 1.5 s.
  const [stillsOnly, setStillsOnly] = useState(() => {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return typeof mem === "number" && mem <= 1;
  });
  const mountedAt = useRef(Date.now());
  const firstVideo = useRef(true);
  const videoLoaded = useCallback(() => {
    if (firstVideo.current && Date.now() - mountedAt.current > 1500) setStillsOnly(true);
    firstVideo.current = false;
  }, []);

  const enterLeanBack = useCallback(() => {
    // From the tile or the control: start the station if it was paused (Lean back is for listening).
    if (!playerRef.current.playing) playerRef.current.play();
    pauseNav();
    setLeanBack(true);
    trackTv("tv_lean_back", playerRef.current.data?.channel?.id ?? null);
  }, []);
  const leaveLeanBack = useCallback(() => {
    setLeanBack(false);
    resumeNav();
  }, []);

  // Two minutes without a key while playing: Lean back. Never when paused.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!leanRef.current && playerRef.current.playing && Date.now() - lastKey.current >= IDLE_MS) enterLeanBack();
    }, 5000);
    return () => window.clearInterval(id);
  }, [enterLeanBack]);
  // Paused from the lock screen or elsewhere: leave Lean back.
  useEffect(() => {
    if (!player.playing && leanBack) leaveLeanBack();
  }, [player.playing, leanBack, leaveLeanBack]);

  const isHome = location.pathname.replace(/\/+$/, "") === "/tv";
  const onPlayScreen = location.pathname.replace(/\/+$/, "") === "/tv/play";

  const back = useCallback((): "handled" | "exit" => {
    if (leanRef.current) {
      leaveLeanBack();
      return "handled";
    }
    // Playing something on demand: Back gives the TV back to the radio (the screen then closes itself).
    if (onPlayScreen && odRef.current.queue) {
      odRef.current.stop();
      return "handled";
    }
    if (!isHome) {
      goBack(navigate);
      return "handled";
    }
    return "exit";
  }, [isHome, onPlayScreen, leaveLeanBack, navigate]);

  const media = useCallback(
    (key: MediaKey) => {
      const p = playerRef.current;
      // While something plays on demand, the media keys are its own.
      const o = odRef.current;
      if (o.queue) {
        if (key === "playpause" || key === "play" || key === "pause") {
          if (key === "playpause" || (key === "play") !== o.playing) o.toggle();
          return;
        }
        if (key === "fastforward") return o.next();
        if (key === "rewind") return o.previous();
      }
      switch (key) {
        case "playpause":
          p.toggle();
          break;
        case "play":
          p.play();
          break;
        case "pause":
          p.pause();
          break;
        case "rewind":
          if (p.canStartOver) p.startOver();
          break;
        case "fastforward":
          if (p.rewound) p.backToLive();
          break;
        case "menu":
          if (leanRef.current) leaveLeanBack();
          navigate("/tv/schedule");
          break;
      }
    },
    [leaveLeanBack, navigate]
  );

  useTvKeys({
    onAnyKey: (e) => {
      lastKey.current = Date.now();
      if (!leanRef.current) return false;
      // A key press only wakes Lean back; Play/Pause also does its job.
      leaveLeanBack();
      if (e.key === "MediaPlayPause" || e.key === " " || e.keyCode === 179) playerRef.current.toggle();
      return true;
    },
    onBack: () => {
      const r = back();
      if (r === "exit") nativeBridge.exitApp(); // in a plain browser this does nothing
    },
    onMedia: (key) => {
      lastKey.current = Date.now();
      media(key);
    },
  });

  // The Fire TV shell talks to the page through this (its keys never reach the page as keydowns).
  useEffect(
    () =>
      registerPageBridge({
        back: () => {
          lastKey.current = Date.now();
          return back();
        },
        media: (key) => {
          lastKey.current = Date.now();
          if (leanRef.current && key !== "playpause" && key !== "play" && key !== "pause") {
            leaveLeanBack();
            return;
          }
          if (leanRef.current) leaveLeanBack();
          media(key);
        },
      }),
    [back, media, leaveLeanBack]
  );

  const ui = useMemo(() => ({ leanBack, enterLeanBack, stillsOnly, videoLoaded }), [leanBack, enterLeanBack, stillsOnly, videoLoaded]);

  return (
    <UiCtx.Provider value={ui}>
      <Stage>
        <div className={leanBack ? "tv-under-lean" : undefined} aria-hidden={leanBack || undefined}>
          <Routes>
            <Route index element={<Home />} />
            <Route path="listen/:slug" element={<NowPlaying />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="shout-out" element={<ShoutOut />} />
            <Route path="play" element={<OnDemand />} />
            <Route path="time-capsule" element={<TimeCapsuleQr />} />
            <Route path="top3" element={<Top3Qr />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </div>
        {leanBack && <LeanBack />}
      </Stage>
    </UiCtx.Provider>
  );
}

export default function TvApp() {
  // Page-wide TV basics while /tv is open: dark, no scrolling, no pointer.
  useEffect(() => {
    document.documentElement.classList.add("tv-mode");
    setAnalyticsPlatform(tvPlatform());
    trackTv("tv_open", null);
    // The Fire TV splash stays up until the page is ready.
    const t = window.setTimeout(() => nativeBridge.shellReady(), 0);
    return () => {
      window.clearTimeout(t);
      document.documentElement.classList.remove("tv-mode");
      setAnalyticsPlatform(null);
    };
  }, []);

  return (
    <TvDataProvider>
      <TvPlayerProvider initialSlug={lastTvChannel() ?? "kizzi-radio"}>
        <OnDemandProvider>
          <TvShell />
        </OnDemandProvider>
      </TvPlayerProvider>
    </TvDataProvider>
  );
}
