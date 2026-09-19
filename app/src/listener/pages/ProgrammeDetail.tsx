import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";
import { EyebrowPill } from "../components/BrandMark";
import { ProgrammeEqSilhouette } from "../components/HeroBackdrop";
import { formatClock, plainText, useExclusiveAudio } from "../lib/audioUtils";

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

export function ProgrammeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [searchParams] = useSearchParams();
  const autoplayed = useRef(false);

  useExclusiveAudio("programme", audioRef);

  useEffect(() => {
    if (!id) return;
    publicApi.programme(id).then((r) => {
      setProgramme(r.programme);
      setItems(r.items);
    });
  }, [id]);

  const playIndex = (index: number) => {
    const item = items[index];
    if (!item?.track_audio_url && !item?.audio_asset_audio_url) return;
    setPlayingIndex(index);
    setCurrentTime(0);
    setDuration(0);
    audioRef.current!.src = mediaUrl(item.track_audio_url ?? item.audio_asset_audio_url);
    audioRef.current!.play().catch(() => {});
  };

  // Start the programme from the top and log it to listening history.
  const startProgramme = () => {
    playIndex(0);
    if (programme) listenerApi.recordPlay("programme", programme.id).catch(() => {});
  };

  // Arriving via a landing-page play button (?autoplay=1) starts the episode
  // straight away - the click that got us here is the user gesture browsers
  // require before audio may play.
  useEffect(() => {
    if (searchParams.get("autoplay") !== "1" || autoplayed.current || items.length === 0 || !programme) return;
    autoplayed.current = true;
    startProgramme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, programme, searchParams]);

  const onEnded = () => {
    if (playingIndex === null) return;
    if (playingIndex + 1 < items.length) {
      playIndex(playingIndex + 1);
    } else {
      setPlayingIndex(null);
    }
  };

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
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const syncFromAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
  };

  if (!programme) return <p>Loading...</p>;

  const isPodcast = !!programme.show_name;
  const current = playingIndex !== null ? items[playingIndex] : null;
  const upNext = playingIndex !== null ? items.slice(playingIndex + 1) : items;
  const currentArt = current?.track_artwork_url ?? programme.artwork_url ?? null;
  const total = duration || current?.audio_asset_duration_seconds || current?.track_duration_seconds || 0;
  const description = plainText(programme.description);

  return (
    <div>
      <div className="programme-hero-art">
        <ProgrammeEqSilhouette />
      </div>

      <EyebrowPill label={isPodcast ? `Podcast · ${programme.show_name}` : "On Air · Kizzi Radio"} />
      {programme.is_flagship ? <span className="badge live" style={{ marginLeft: 8 }}>FLAGSHIP</span> : null}
      <h1 className="programme-headline">{programme.title}</h1>
      {description && <p className="programme-description" style={{ whiteSpace: "pre-line" }}>{description}</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {isPodcast ? (
          <button
            className="pill-btn pill-btn-solid"
            onClick={() => (current ? togglePause() : startProgramme())}
            disabled={items.length === 0}
          >
            {current && !paused ? <span className="pl-pause-icon"><span /><span /></span> : <span className="play-triangle" />}
            {current ? (paused ? "Resume" : "Pause") : "Play episode"}
          </button>
        ) : (
          <>
            <button className="pill-btn pill-btn-solid" onClick={() => navigate("/listen")}>
              <span className="play-triangle" />
              Listen Now
            </button>
            <button className="pill-btn pill-btn-ghost" onClick={startProgramme} disabled={items.length === 0}>
              Listen On Demand
            </button>
          </>
        )}
        <FavouriteButton itemType="programme" itemId={programme.id} />
      </div>

      {current && (
        <div className={`now-playing-card${paused ? " is-paused" : ""}`}>
          {currentArt ? (
            <img className="now-playing-card-art" src={mediaUrl(currentArt)} alt="" />
          ) : (
            <div className="now-playing-card-art" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="now-playing-card-label">{paused ? "Paused" : "Now Playing"}</div>
            <div className="now-playing-card-title">
              {current.label ?? current.track_title ?? current.audio_asset_title}
            </div>

            <div className="pl-controls">
              <button className="pl-skip" onClick={() => skip(-15)} aria-label="Back 15 seconds">
                <RewindIcon />
              </button>
              <button className="pl-play" onClick={togglePause} aria-label={paused ? "Play" : "Pause"}>
                {paused ? <span className="play-triangle" /> : <span className="pl-pause-icon"><span /><span /></span>}
              </button>
              <button className="pl-skip" onClick={() => skip(30)} aria-label="Forward 30 seconds">
                <ForwardIcon />
              </button>
              <button className="pl-rate" onClick={cycleRate} aria-label={`Playback speed ${rate}x`}>
                {rate}×
              </button>
            </div>

            <div className="pl-seek">
              <span className="pl-time">{formatClock(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(total, 1)}
                step={1}
                value={Math.min(currentTime, Math.max(total, 1))}
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
      )}

      {!isPodcast && (
        <>
          <h3 style={{ fontFamily: "var(--font-display)", textTransform: "uppercase" }}>
            {current ? "Up Next" : "Running order"}
          </h3>
          <div className="up-next-list">
            {upNext.map((item) => (
              <div key={item.id} className="up-next-row">
                {item.track_artwork_url ? (
                  <img className="up-next-thumb" src={mediaUrl(item.track_artwork_url)} alt="" />
                ) : (
                  <div className="up-next-thumb" />
                )}
                <span className="up-next-title">{item.label ?? item.track_title ?? item.audio_asset_title}</span>
                <span className="up-next-duration">
                  {Math.round((item.track_duration_seconds ?? item.audio_asset_duration_seconds ?? 0) / 60)} min
                </span>
                <button className="btn" onClick={() => playIndex(items.indexOf(item))} style={{ marginLeft: 8 }}>
                  Play
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <audio
        ref={audioRef}
        onEnded={onEnded}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={syncFromAudio}
        onLoadedMetadata={(e) => {
          // Loading a new source resets the speed, so re-apply the chosen one.
          e.currentTarget.playbackRate = rate;
          syncFromAudio();
        }}
        onDurationChange={syncFromAudio}
        style={{ display: "none" }}
      />
    </div>
  );
}
