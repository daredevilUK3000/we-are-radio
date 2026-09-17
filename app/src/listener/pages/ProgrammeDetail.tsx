import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";

export function ProgrammeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
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

  if (!programme) return <p>Loading...</p>;

  return (
    <div>
      {programme.is_flagship ? <span className="badge live">FLAGSHIP</span> : null}
      <h1>{programme.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{programme.description}</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button className="btn primary" onClick={() => navigate("/listen")}>
          Listen Now
        </button>
        <button
          className="btn"
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

      <h3>Running order</h3>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="running-order-item"
          style={{ cursor: "default", ...(playingIndex === index ? { borderColor: "var(--accent)" } : {}) }}
        >
          <span className="badge">{item.item_type}</span>
          <span style={{ flex: 1 }}>{item.label ?? item.track_title ?? item.audio_asset_title}</span>
          <button className="btn" onClick={() => playIndex(index)}>
            {playingIndex === index ? "Playing" : "Play"}
          </button>
        </div>
      ))}

      <audio ref={audioRef} onEnded={onEnded} style={{ width: "100%", marginTop: 20 }} controls />
    </div>
  );
}
