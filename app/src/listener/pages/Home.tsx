import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";

export function Home() {
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [flagship, setFlagship] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    publicApi.nowPlaying().then(setNowPlaying).catch(() => {});
    publicApi.programmes({ is_flagship: true }).then((r) => setFlagship(r.programmes)).catch(() => {});
    publicApi.channels().then((r) => setChannels(r.channels)).catch(() => {});
  }, []);

  return (
    <div>
      <section style={{ textAlign: "center", padding: "40px 0" }}>
        <h1 style={{ marginBottom: 4 }}>Kizzi Radio</h1>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
          {nowPlaying?.on_air ? nowPlaying.programme?.title : "Kizzi's personal radio network"}
        </p>
        <Link to="/listen" className="listen-now-btn">
          LISTEN NOW
        </Link>
      </section>

      {flagship.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2>Saturday Morning with Kizzi</h2>
          <div className="grid">
            {flagship.map((p) => (
              <Link key={p.id} to={`/programmes/${p.id}`} className="card">
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>
                  {p.description?.slice(0, 60)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Explore Channels</h2>
        <div className="grid">
          {channels.map((c) => (
            <div key={c.id} className="card">
              <div style={{ fontSize: "1.4rem" }}>{c.emoji}</div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{c.description}</div>
            </div>
          ))}
          {channels.length === 0 && (
            <div style={{ color: "var(--text-dim)" }}>No channels are live yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
