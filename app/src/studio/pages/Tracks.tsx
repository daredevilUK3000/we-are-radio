import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";

export function Tracks() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = () => studioApi.tracks().then((r) => setTracks(r.tracks));
  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await studioApi.updateTrack(id, { status });
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Tracks</h1>
        <Link to="/studio/tracks/upload" className="btn primary">
          Upload music
        </Link>
      </div>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Genre</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <td>{t.title}</td>
                <td>{t.genre}</td>
                <td>
                  <span className="badge">{t.status}</span>
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => setPlayingId(playingId === t.id ? null : t.id)}
                  >
                    {playingId === t.id ? "Hide player" : "Play"}
                  </button>
                  {t.status !== "published" && (
                    <button className="btn" onClick={() => setStatus(t.id, "published")}>
                      Publish
                    </button>
                  )}
                </td>
              </tr>
              {playingId === t.id && (
                <tr>
                  <td colSpan={4} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(t.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {tracks.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "var(--text-dim)" }}>
                Nothing uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
