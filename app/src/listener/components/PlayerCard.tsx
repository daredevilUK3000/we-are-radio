import { useEffect, useState, type RefObject } from "react";
import { mediaUrl } from "../../api/client";
import { formatClock } from "../lib/audioUtils";

const RATES = [1, 1.25, 1.5, 2];

function RewindIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 4v4.5h4.5" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">15</text>
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4.5h-4.5" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">30</text>
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
      <path d="M19 5.5v13a.8.8 0 0 1-1.25.66l-9-6.5a.8.8 0 0 1 0-1.32l9-6.5A.8.8 0 0 1 19 5.5z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
      <path d="M5 5.5v13a.8.8 0 0 0 1.25.66l9-6.5a.8.8 0 0 0 0-1.32l-9-6.5A.8.8 0 0 0 5 5.5z" />
    </svg>
  );
}

/**
 * "Now playing" card with full transport controls - play/pause, back 15s,
 * forward 30s, a seekable slider with times, and playback speed - driving an
 * <audio> element that the page owns (and that stays hidden). Pass onPrev /
 * onNext when the page plays a list, to add previous/next track buttons.
 */
export function PlayerCard({
  audioRef,
  title,
  artUrl,
  fallbackDuration,
  onPrev,
  onNext,
  subtitle,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  title: string;
  artUrl?: string | null;
  fallbackDuration?: number | null;
  onPrev?: () => void;
  onNext?: () => void;
  subtitle?: string;
}) {
  const [paused, setPaused] = useState(() => audioRef.current?.paused ?? true);
  const [currentTime, setCurrentTime] = useState(() => audioRef.current?.currentTime ?? 0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(() => audioRef.current?.playbackRate ?? 1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      setPaused(audio.paused);
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const events = ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "emptied"];
    events.forEach((e) => audio.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => audio.removeEventListener(e, sync));
  }, [audioRef]);

  const togglePause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

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

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    const audio = audioRef.current;
    if (audio) {
      // defaultPlaybackRate is what a newly loaded source (the next track)
      // resets to, so setting it keeps the chosen speed across tracks.
      audio.defaultPlaybackRate = next;
      audio.playbackRate = next;
    }
  };

  const total = duration || fallbackDuration || 0;
  const max = Math.max(total, 1);

  return (
    <div className={`now-playing-card${paused ? " is-paused" : ""}`}>
      {artUrl ? (
        <img className="now-playing-card-art" src={mediaUrl(artUrl)} alt="" />
      ) : (
        <div className="now-playing-card-art" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="now-playing-card-label">{paused ? "Paused" : "Now Playing"}</div>
        <div className="now-playing-card-title">{title}</div>
        {subtitle && <div className="now-playing-card-sub">{subtitle}</div>}

        <div className="pl-controls">
          {onPrev && (
            <button className="pl-skip" onClick={onPrev} aria-label="Previous track">
              <PrevIcon />
            </button>
          )}
          <button className="pl-skip" onClick={() => skip(-15)} aria-label="Back 15 seconds">
            <RewindIcon />
          </button>
          <button className="pl-play" onClick={togglePause} aria-label={paused ? "Play" : "Pause"}>
            {paused ? (
              <span className="play-triangle" />
            ) : (
              <span className="pl-pause-icon">
                <span />
                <span />
              </span>
            )}
          </button>
          <button className="pl-skip" onClick={() => skip(30)} aria-label="Forward 30 seconds">
            <ForwardIcon />
          </button>
          {onNext && (
            <button className="pl-skip" onClick={onNext} aria-label="Next track">
              <NextIcon />
            </button>
          )}
          <button className="pl-rate" onClick={cycleRate} aria-label={`Playback speed ${rate}x`}>
            {rate}×
          </button>
        </div>

        <div className="pl-seek">
          <span className="pl-time">{formatClock(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={Math.min(currentTime, max)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className="pl-time">{formatClock(total)}</span>
        </div>
      </div>
      <div className="live-waveform">
        <span style={{ animationDelay: "0s" }} />
        <span style={{ animationDelay: "0.15s" }} />
        <span style={{ animationDelay: "0.3s" }} />
        <span style={{ animationDelay: "0.45s" }} />
      </div>
    </div>
  );
}
