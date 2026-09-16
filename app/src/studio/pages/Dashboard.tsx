import { useEffect, useState } from "react";
import { studioApi } from "../../api/client";

export function Dashboard() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    studioApi.tracks().then((r) => setTracks(r.tracks)).catch(() => {});
    studioApi.programmes().then((r) => setProgrammes(r.programmes)).catch(() => {});
    studioApi.channels().then((r) => setChannels(r.channels)).catch(() => {});
  }, []);

  const liveChannels = channels.filter((c) => c.status === "live");
  const publishedProgrammes = programmes.filter((p) => p.status === "published");

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="grid">
        <div className="card">
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>LIVE CHANNELS</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{liveChannels.length} / {channels.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>PUBLISHED PROGRAMMES</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{publishedProgrammes.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>TRACKS IN CATALOGUE</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{tracks.length}</div>
        </div>
      </div>

      <h3 style={{ marginTop: 32 }}>Recent tracks</h3>
      <table>
        <tbody>
          {tracks.slice(0, 8).map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>
                <span className="badge">{t.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
