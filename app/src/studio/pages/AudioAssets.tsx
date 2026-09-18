import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";
import { MOOD_OPTIONS } from "../lib/presets";

export function AudioAssets() {
  const [assets, setAssets] = useState<any[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);

  const load = () => studioApi.audioAssets().then((r) => setAssets(r.audio_assets));
  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await studioApi.updateAudioAsset(id, { status });
    load();
  };

  const tagsFor = (a: any): string[] => (a.tag_names ? a.tag_names.split(",") : []);

  const setTags = async (id: string, tags: string[]) => {
    await studioApi.setAudioAssetTags(id, tags);
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
        blocks of a running order. Tag jingles/station IDs with "morning", "afternoon",
        "evening" or "night" so the right one plays when the main player switches channel
        (Phase 3's time-of-day flow).
      </p>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Tags</th>
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
                  {tagsFor(a).length > 0 ? (
                    tagsFor(a).map((t) => (
                      <span key={t} className="badge" style={{ marginRight: 4 }}>
                        {t}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "var(--text-dim)" }}>none</span>
                  )}
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
                  <button
                    className="btn"
                    onClick={() => setEditingTagsId(editingTagsId === a.id ? null : a.id)}
                  >
                    {editingTagsId === a.id ? "Done" : "Edit tags"}
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
                  <td colSpan={5} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(a.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
              {editingTagsId === a.id && (
                <tr>
                  <td colSpan={5} style={{ paddingTop: 0 }}>
                    <ChipPicker options={MOOD_OPTIONS} value={tagsFor(a)} onChange={(next) => setTags(a.id, next)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {assets.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                Nothing uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
