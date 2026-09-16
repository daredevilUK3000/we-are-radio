import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";

export function AudioAssets() {
  const [assets, setAssets] = useState<any[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

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
            <Fragment key={a.id}>
              <tr>
                <td>{a.title}</td>
                <td>
                  <span className="badge">{a.type}</span>
                </td>
                <td>
                  <span className="badge">{a.status}</span>
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => setPlayingId(playingId === a.id ? null : a.id)}
                  >
                    {playingId === a.id ? "Hide player" : "Play"}
                  </button>
                  {a.status !== "published" && (
                    <button className="btn" onClick={() => setStatus(a.id, "published")}>
                      Publish
                    </button>
                  )}
                </td>
              </tr>
              {playingId === a.id && (
                <tr>
                  <td colSpan={4} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(a.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
            </Fragment>
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
