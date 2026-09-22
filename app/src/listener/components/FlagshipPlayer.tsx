import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { formatClock } from "../lib/audioUtils";

const BAR_COUNT = 46;

// A tiny deterministic hash, so each track gets its own waveform "shape"
// instead of a plain progress line - reused from the same trick the
// expanded Now Playing waveform uses (NowPlayingExpanded.tsx).
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function barHeights(seed: string): number[] {
  let state = hash(seed) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const envelope = 0.4 + 0.6 * Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);
    return Math.round((0.3 + next() * 0.7) * envelope * 100);
  });
}

function RewindIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5L3 12l6 7M3 12h18" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l6 7-6 7M21 12H3" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      <path d="M17 8.5c1.4 1.4 1.4 5.6 0 7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The flagship Now Playing page's custom player bar: back-15/play/forward-30,
 * a waveform-shaped scrubber (click or drag to seek) instead of a plain
 * range line, remaining/total time, volume, and a pair of decorative VU
 * meters. Drives the page's own <audio> element rather than owning one -
 * play/pause is controlled by the caller (the big button over the artwork
 * mirrors this same state).
 */
export function FlagshipPlayer({
  audioRef,
  accent,
  seed,
  playing,
  onTogglePlay,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  accent: string;
  seed: string;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const [currentTime, setCurrentTime] = useState(() => audioRef.current?.currentTime ?? 0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => audioRef.current?.volume ?? 1);
  const scrubRef = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => barHeights(seed), [seed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onVolume = () => setVolume(audio.volume);
    const events = ["timeupdate", "loadedmetadata", "durationchange", "emptied"];
    events.forEach((e) => audio.addEventListener(e, sync));
    audio.addEventListener("volumechange", onVolume);
    sync();
    onVolume();
    return () => {
      events.forEach((e) => audio.removeEventListener(e, sync));
      audio.removeEventListener("volumechange", onVolume);
    };
  }, [audioRef]);

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.max(0, Math.min(limit, audio.currentTime + seconds));
    setCurrentTime(audio.currentTime);
  };

  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const seekAtClientX = (clientX: number) => {
    const el = scrubRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(fraction * duration);
  };

  const onScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekAtClientX(e.clientX);
  };

  const onScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    seekAtClientX(e.clientX);
  };

  const onScrubKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") skip(-5);
    else if (e.key === "ArrowRight") skip(5);
    else return;
    e.preventDefault();
  };

  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const remaining = Math.max(0, duration - currentTime);
  const playedFraction = duration > 0 ? currentTime / duration : 0;

  return (
    <div className={`lp-player${playing ? " is-playing" : ""}`}>
      <button className="lp-skip" onClick={() => skip(-15)} aria-label="Back 15 seconds">
        <RewindIcon />
      </button>
      <button className="lp-play" style={{ background: accent }} onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? (
          <span className="pl-pause-icon">
            <span />
            <span />
          </span>
        ) : (
          <span className="play-triangle" />
        )}
      </button>
      <button className="lp-skip" onClick={() => skip(30)} aria-label="Forward 30 seconds">
        <ForwardIcon />
      </button>

      <span className="lp-time">{formatClock(currentTime)}</span>

      <div
        ref={scrubRef}
        className="lp-scrub"
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
        onPointerDown={onScrubPointerDown}
        onPointerMove={onScrubPointerMove}
        onKeyDown={onScrubKeyDown}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            style={{
              height: `${h}%`,
              background: i / BAR_COUNT <= playedFraction ? accent : "rgba(255,255,255,0.18)",
            }}
          />
        ))}
      </div>

      <span className="lp-time">{formatClock(remaining)}</span>

      <span className="lp-volume-icon" aria-hidden="true">
        <VolumeIcon />
      </span>
      <input
        className="lp-volume"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={onVolumeChange}
        aria-label="Volume"
      />

      <div className="lp-vu" aria-hidden="true">
        <span style={{ animationDelay: "0s" }}>
          <i style={{ background: `linear-gradient(to top, ${accent} 0%, ${accent} 60%, #F5B942 100%)` }} />
        </span>
        <span style={{ animationDelay: "0.15s" }}>
          <i style={{ background: `linear-gradient(to top, ${accent} 0%, ${accent} 60%, #F5B942 100%)` }} />
        </span>
      </div>
    </div>
  );
}
