import { useEffect, useState } from "react";
import { publicApi } from "../../api/client";

export function Listen() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const poll = () => publicApi.nowPlaying().then(setData).catch(() => {});
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <p>Tuning in...</p>;
  if (!data.on_air) return <p>Kizzi Radio isn't broadcasting a published programme yet.</p>;

  return (
    <div>
      <span className="on-air-badge">
        <span className="on-air-dot" /> ON AIR &middot; {data.channel.name}
      </span>
      <h1 style={{ marginBottom: 4 }}>{data.programme?.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{data.programme?.description}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 4 }}>NOW PLAYING</div>
        <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{data.now_playing?.label}</div>
      </div>

      {data.up_next && (
        <div className="card">
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 4 }}>UP NEXT</div>
          <div>{data.up_next.label}</div>
        </div>
      )}
    </div>
  );
}
