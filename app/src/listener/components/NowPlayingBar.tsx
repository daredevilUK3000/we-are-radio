import { useEffect, useRef, useState } from "react";
import { publicApi } from "../../api/client";

export function NowPlayingBar() {
  const [data, setData] = useState<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      publicApi
        .nowPlaying()
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData(null));
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data || !data.on_air) return null;

  return (
    <div className="now-playing-bar">
      <span className="on-air-badge">
        <span className="on-air-dot" /> ON AIR
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.now_playing?.label ?? "Kizzi Radio"}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
          {data.up_next ? `Up next: ${data.up_next.label}` : data.programme?.title}
        </div>
      </div>
      <button
        className="btn primary"
        onClick={() => {
          if (!audioRef.current) return;
          if (playing) {
            audioRef.current.pause();
          } else {
            audioRef.current.play().catch(() => {});
          }
          setPlaying(!playing);
        }}
      >
        {playing ? "Pause" : "Play"}
      </button>
      {/* audio_url resolution against R2/media is wired up once tracks carry real playable URLs */}
      <audio ref={audioRef} />
    </div>
  );
}
