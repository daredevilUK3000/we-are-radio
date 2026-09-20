import { Fragment, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { studioApi, mediaUrl, uploadFileToR2 } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";
import { MOOD_OPTIONS } from "../lib/presets";
import { runPool } from "../lib/bulkImport";

export function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState<any>(null);
  const [albumTracks, setAlbumTracks] = useState<any[]>([]);
  const [allTracks, setAllTracks] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Album cover: pick an image, see it, then save it (or remove the current one).
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMessage, setCoverMessage] = useState<string | null>(null);

  // Track tags: pick some, then add them to (or take them off) the ticked tracks.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagPick, setTagPick] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [channelHints, setChannelHints] = useState<Map<string, string[]>>(new Map());

  // Which channel each tag feeds, so tagging is a choice about where a track plays.
  useEffect(() => {
    studioApi
      .channels()
      .then((r) => {
        const hints = new Map<string, string[]>();
        for (const c of r.channels) {
          try {
            const tags: string[] = c.catalogue_rules ? JSON.parse(c.catalogue_rules).tags_any ?? [] : [];
            for (const t of tags) hints.set(t, [...(hints.get(t) ?? []), c.name]);
          } catch {
            // a channel with unreadable rules just gives no hint
          }
        }
        setChannelHints(hints);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!coverFile) return setCoverPreview(null);
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const load = async () => {
    if (!id) return;
    setLoadError(null);
    try {
      const [a, t] = await Promise.all([studioApi.album(id), studioApi.tracks()]);
      setAlbum(a.album);
      setAlbumTracks(a.tracks);
      setAllTracks(t.tracks);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load album");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loadError) {
    return (
      <p style={{ color: "var(--accent)" }}>
        Couldn't load this album ({loadError}).{" "}
        <button className="btn" onClick={load} type="button">
          Retry
        </button>
      </p>
    );
  }

  const addTrack = async (trackId: string) => {
    if (!id || !trackId) return;
    await studioApi.updateTrack(trackId, { album_id: id });
    load();
  };

  const toggleFeatured = async () => {
    if (!id) return;
    await studioApi.setAlbumFeatured(id, !album.is_featured);
    load();
  };

  const removeTrack = async (trackId: string) => {
    await studioApi.updateTrack(trackId, { album_id: null });
    load();
  };

  const setTrackNumber = async (trackId: string, trackNumber: string) => {
    await studioApi.updateTrack(trackId, { track_number: trackNumber ? Number(trackNumber) : null });
    load();
  };

  const chooseCover = (file: File | null) => {
    setCoverMessage(null);
    if (file && !file.type.startsWith("image/")) {
      setCoverFile(null);
      return setCoverMessage("That isn't an image - please choose a JPG, PNG or WebP picture.");
    }
    if (file && file.size > 15 * 1024 * 1024) {
      setCoverFile(null);
      return setCoverMessage("That image is over 15 MB - please choose a smaller one.");
    }
    setCoverFile(file);
  };

  const saveCover = async () => {
    if (!id || !coverFile) return;
    setCoverBusy(true);
    setCoverMessage(null);
    try {
      const presigned = await studioApi.presignUpload(coverFile.name, coverFile.type, "artwork");
      await uploadFileToR2(presigned.upload_url, coverFile);
      await studioApi.updateAlbum(id, { artwork_url: presigned.key });
      setCoverFile(null);
      setCoverMessage("Cover saved.");
      await load();
    } catch (err) {
      setCoverMessage(err instanceof Error ? err.message : "Could not save the cover - please try again.");
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    if (!id) return;
    setCoverBusy(true);
    try {
      await studioApi.updateAlbum(id, { artwork_url: null });
      setCoverMessage("Cover removed.");
      await load();
    } finally {
      setCoverBusy(false);
    }
  };

  const tagsOf = (t: any): string[] => (t.tag_names ? String(t.tag_names).split(",") : []);

  const saveTrackTags = async (trackId: string, tags: string[]) => {
    setAlbumTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, tag_names: tags.join(",") } : t)));
    try {
      await studioApi.setTrackTags(trackId, tags);
    } catch {
      setTagMessage("Couldn't save those tags - please try again.");
      load();
    }
  };

  const toggleSelected = (trackId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });

  const applyTags = async (mode: "add" | "remove") => {
    const targets = albumTracks.filter((t) => selected.has(t.id));
    if (targets.length === 0 || tagPick.length === 0) return;
    setTagBusy(true);
    setTagMessage(null);
    let failed = 0;
    await runPool(targets, 4, async (t) => {
      const current = tagsOf(t);
      const next =
        mode === "add" ? Array.from(new Set([...current, ...tagPick])) : current.filter((x) => !tagPick.includes(x));
      try {
        await studioApi.setTrackTags(t.id, next);
      } catch {
        failed++;
      }
    });
    setTagBusy(false);
    setTagMessage(
      `${mode === "add" ? "Added" : "Removed"} ${tagPick.join(", ")} ${mode === "add" ? "to" : "from"} ${
        targets.length - failed
      } track${targets.length - failed === 1 ? "" : "s"}${failed ? ` (${failed} failed - try again)` : ""}.`
    );
    load();
  };

  const untaggedCount = albumTracks.filter((t) => tagsOf(t).length === 0).length;

  if (!album) return <p>Loading...</p>;

  const availableTracks = allTracks.filter((t) => t.album_id !== album.id);

  return (
    <div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ width: 160, flexShrink: 0 }}>
          {coverPreview || album.artwork_url ? (
            <img
              src={coverPreview ?? mediaUrl(album.artwork_url)}
              alt="Album cover"
              width={160}
              height={160}
              style={{ objectFit: "cover", borderRadius: 8, display: "block" }}
            />
          ) : (
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 8,
                border: "1px dashed var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: "0.85rem",
                textAlign: "center",
                padding: 10,
              }}
            >
              No cover yet
            </div>
          )}
          <label className="btn" style={{ display: "block", marginTop: 8, textAlign: "center", cursor: "pointer" }}>
            {album.artwork_url || coverFile ? "Choose a different cover" : "Choose cover image"}
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                chooseCover(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
          {coverFile && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={saveCover} disabled={coverBusy}>
                {coverBusy ? "Saving..." : "Save cover"}
              </button>
              <button className="btn" onClick={() => setCoverFile(null)} disabled={coverBusy}>
                Cancel
              </button>
            </div>
          )}
          {!coverFile && album.artwork_url && (
            <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={removeCover} disabled={coverBusy}>
              Remove cover
            </button>
          )}
          {coverMessage && <p style={{ fontSize: "0.8rem", color: "var(--text-dim)", margin: "6px 0 0" }}>{coverMessage}</p>}
          {!coverFile && !coverMessage && !album.artwork_url && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "6px 0 0" }}>
              A square picture (at least 1000 x 1000) looks best.
            </p>
          )}
        </div>
        <div>
          <h1 style={{ marginTop: 0, marginBottom: 4 }}>{album.title}</h1>
          <p style={{ color: "var(--text-dim)" }}>{album.description}</p>
          <button className={album.is_featured ? "btn primary" : "btn"} onClick={toggleFeatured}>
            {album.is_featured ? "★ Featured on landing page - click to remove" : "Feature on landing page"}
          </button>
        </div>
      </div>

      <h3>Tracks on this album</h3>

      {albumTracks.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <strong>Tag tracks</strong>
            <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
              {selected.size} selected · {untaggedCount} without tags
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setSelected(new Set(albumTracks.map((t) => t.id)))}>
              Select all
            </button>
            <button
              className="btn"
              onClick={() => setSelected(new Set(albumTracks.filter((t) => tagsOf(t).length === 0).map((t) => t.id)))}
              disabled={untaggedCount === 0}
            >
              Select untagged
            </button>
            <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...MOOD_OPTIONS, ...tagPick.filter((t) => !MOOD_OPTIONS.includes(t))].map((tag) => (
              <button
                key={tag}
                type="button"
                className={`chip${tagPick.includes(tag) ? " selected" : ""}`}
                title={channelHints.get(tag) ? `Feeds: ${channelHints.get(tag)!.join(", ")}` : undefined}
                onClick={() => setTagPick((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]))}
              >
                {tag}
                {channelHints.get(tag) ? ` → ${channelHints.get(tag)!.join(", ")}` : ""}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={customTag}
              placeholder="Add your own tag..."
              style={{ maxWidth: 220 }}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customTag.trim()) {
                  setTagPick((p) => Array.from(new Set([...p, customTag.trim()])));
                  setCustomTag("");
                }
              }}
            />
            <button
              className="btn primary"
              onClick={() => applyTags("add")}
              disabled={tagBusy || tagPick.length === 0 || selected.size === 0}
            >
              Add to selected
            </button>
            <button
              className="btn"
              onClick={() => applyTags("remove")}
              disabled={tagBusy || tagPick.length === 0 || selected.size === 0}
            >
              Remove from selected
            </button>
          </div>
          <small style={{ color: "var(--text-dim)", display: "block", marginTop: 8 }}>
            Tags decide which channels a track can play on (shown after the arrow) and which My Mood mixes it appears in.
            Tick the tracks, choose the tags, then Add. You can also click a track's tags to edit just that one.
          </small>
          {tagMessage && <p style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>{tagMessage}</p>}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }}></th>
            <th>#</th>
            <th>Title</th>
            <th>Tags</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {albumTracks.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelected(t.id)}
                    aria-label={`Select ${t.title}`}
                  />
                </td>
                <td style={{ width: 60 }}>
                  <input
                    type="number"
                    defaultValue={t.track_number ?? ""}
                    onBlur={(e) => setTrackNumber(t.id, e.target.value)}
                    style={{ width: 50 }}
                  />
                </td>
                <td>{t.title}</td>
                <td>
                  <button
                    className="btn"
                    onClick={() => setEditingTagsId(editingTagsId === t.id ? null : t.id)}
                    title="Edit this track's tags"
                  >
                    {tagsOf(t).length > 0 ? tagsOf(t).join(", ") : "add tags"}
                  </button>
                </td>
                <td>
                  <span className="badge">{t.status}</span>
                </td>
                <td>
                  <button className="btn" onClick={() => removeTrack(t.id)}>
                    Remove from album
                  </button>
                </td>
              </tr>
              {editingTagsId === t.id && (
                <tr>
                  <td colSpan={6} style={{ paddingTop: 0 }}>
                    <ChipPicker options={MOOD_OPTIONS} value={tagsOf(t)} onChange={(next) => saveTrackTags(t.id, next)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {albumTracks.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--text-dim)" }}>
                No tracks assigned yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>Add a track</h4>
        <select onChange={(e) => e.target.value && addTrack(e.target.value)} value="">
          <option value="">+ Add track to this album...</option>
          {availableTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
