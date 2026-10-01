import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";
import { schedApi } from "../scheduler/api";
import { onAirStudioApi } from "../../api/onAir";

function hoursAgo(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

export function Dashboard() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [schedHealth, setSchedHealth] = useState<{ red: number; amber: number } | null>(null);
  const [voices, setVoices] = useState<{ pending: number; oldest: string | null; flagged: number } | null>(null);

  useEffect(() => {
    studioApi.tracks().then((r) => setTracks(r.tracks)).catch(() => {});
    studioApi.programmes().then((r) => setProgrammes(r.programmes)).catch(() => {});
    studioApi.channels().then((r) => setChannels(r.channels)).catch(() => {});
    schedApi
      .health()
      .then((r) => setSchedHealth({ red: r.checks.filter((c) => c.level === "red").length, amber: r.checks.filter((c) => c.level === "amber").length }))
      .catch(() => {});
    onAirStudioApi.summary().then(setVoices).catch(() => {});
  }, []);

  const liveChannels = channels.filter((c) => c.status === "live");
  const publishedProgrammes = programmes.filter((p) => p.status === "published");

  return (
    <div>
      <h1>Dashboard</h1>

      <div
        className="card"
        style={{
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <strong>Got a new song to put out?</strong>
          <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
            One guided flow: upload, choose an album, publish - in that order, nothing skipped.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/studio/guide" className="btn">
            Read the guide
          </Link>
          <Link to="/studio/publish" className="btn primary">
            Publish music
          </Link>
        </div>
      </div>

      {schedHealth && (
        <Link to="/studio/scheduler" className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, textDecoration: "none" }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: "50%", background: schedHealth.red ? "#e11d2e" : schedHealth.amber ? "#f2b33d" : "#34d27b" }}
          />
          <strong>Scheduler:</strong>
          <span>{schedHealth.red ? `Action needed (${schedHealth.red})` : schedHealth.amber ? `Attention (${schedHealth.amber} items)` : "All clear"}</span>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>Master Control →</span>
        </Link>
      )}

      {voices && (voices.pending > 0 || voices.flagged > 0) && (
        <Link to="/studio/on-air" className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, textDecoration: "none" }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>🎙</span>
          <strong>Listener voices:</strong>
          <span>
            {voices.pending > 0
              ? `${voices.pending} ${voices.pending === 1 ? "voice" : "voices"} waiting${voices.oldest ? ` · oldest ${hoursAgo(voices.oldest)}` : ""}`
              : ""}
            {voices.flagged > 0 ? `${voices.pending > 0 ? " · " : ""}${voices.flagged} need a look` : ""}
          </span>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>Open →</span>
        </Link>
      )}

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
