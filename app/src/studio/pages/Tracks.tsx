import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";

export function Tracks() {
  const [tracks, setTracks] = useState<any[]>([]);

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
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{t.genre}</td>
              <td>
                <span className="badge">{t.status}</span>
              </td>
              <td>
                {t.status !== "published" && (
                  <button className="btn" onClick={() => setStatus(t.id, "published")}>
                    Publish
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
