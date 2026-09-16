import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";

export function AudioAssets() {
  const [assets, setAssets] = useState<any[]>([]);

  const load = () => studioApi.audioAssets().then((r) => setAssets(r.audio_assets));
  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await studioApi.updateAudioAsset(id, { status });
    load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Voice &amp; Station Audio</h1>
        <Link to="/studio/audio/upload" className="btn primary">
          Upload audio
        </Link>
      </div>
      <p style={{ color: "var(--text-dim)" }}>
        Station IDs, jingles, spoken links, features and interviews - the non-song building
        blocks of a running order.
      </p>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>{a.title}</td>
              <td>
                <span className="badge">{a.type}</span>
              </td>
              <td>
                <span className="badge">{a.status}</span>
              </td>
              <td>
                {a.status !== "published" && (
                  <button className="btn" onClick={() => setStatus(a.id, "published")}>
                    Publish
                  </button>
                )}
              </td>
            </tr>
          ))}
          {assets.length === 0 && (
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
