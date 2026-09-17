import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";
import { EyebrowPill } from "../components/BrandMark";
import { ProgrammeEqSilhouette } from "../components/HeroBackdrop";

export function ProgrammeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    setProgress(0);
    audioRef.current!.src = mediaUrl(item.track_audio_url ?? item.audio_asset_audio_url);
    audioRef.current!.play().catch(() => {});
  };

  const onEnded = () => {
    if (playingIndex === null) return;
    if (playingIndex + 1 < items.length) {
      playIndex(playingIndex + 1);
    } else {
      setPlayingIndex(null);
    }
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    setProgress((audio.currentTime / audio.duration) * 100);
  };

  if (!programme) return <p>Loading...</p>;

  const current = playingIndex !== null ? items[playingIndex] : null;
  const upNext = playingIndex !== null ? items.slice(playingIndex + 1) : items;

  return (
    <div>
      <div className="programme-hero-art">
        <ProgrammeEqSilhouette />
      </div>

      <EyebrowPill label="On Air · Kizzi Radio" />
      {programme.is_flagship ? <span className="badge live" style={{ marginLeft: 8 }}>FLAGSHIP</span> : null}
      <h1 className="programme-headline">{programme.title}</h1>
      <p className="programme-description">{programme.description}</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        <button className="pill-btn pill-btn-solid" onClick={() => navigate("/listen")}>
          <span className="play-triangle" />
          Listen Now
        </button>
        <button
          className="pill-btn pill-btn-ghost"
          onClick={() => {
            playIndex(0);
            listenerApi.recordPlay("programme", programme.id).catch(() => {});
          }}
          disabled={items.length === 0}
        >
          Listen On Demand
        </button>
        <FavouriteButton itemType="programme" itemId={programme.id} />
      </div>

      {current && (
        <div className="now-playing-card">
          {current.track_artwork_url ? (
            <img className="now-playing-card-art" src={mediaUrl(current.track_artwork_url)} alt="" />
          ) : (
            <div className="now-playing-card-art" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="now-playing-card-label">Now Playing</div>
            <div className="now-playing-card-title">
              {current.label ?? current.track_title ?? current.audio_asset_title}
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
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
            <button
              className="btn"
              onClick={() => playIndex(items.indexOf(item))}
              style={{ marginLeft: 8 }}
            >
              Play
            </button>
          </div>
        ))}
      </div>

      <audio ref={audioRef} onEnded={onEnded} onTimeUpdate={onTimeUpdate} style={{ display: "none" }} />
    </div>
  );
}
