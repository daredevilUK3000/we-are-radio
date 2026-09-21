import { Fragment, useEffect, useMemo, useState } from "react";
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

  // Album title: click Rename, fix it, Save.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Adding tracks: tick as many as you like from the list, then add them in one go.
  const [addSearch, setAddSearch] = useState("");
  const [onlyNoAlbum, setOnlyNoAlbum] = useState(true);
  const [addPick, setAddPick] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);

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

  // Every track that isn't already on this album (newest first, as the API sends them).
  const addable = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    return allTracks.filter(
      (t) =>
        t.album_id !== id &&
        (!onlyNoAlbum || !t.album_id) &&
        (!q || t.title.toLowerCase().includes(q) || (t.artist ?? "").toLowerCase().includes(q))
    );
  }, [allTracks, id, addSearch, onlyNoAlbum]);

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

  const toggleAddPick = (trackId: string) =>
    setAddPick((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });

  const addPicked = async () => {
    if (!id) return;
    const targets = allTracks.filter((t) => addPick.has(t.id));
    if (targets.length === 0) return;
    // Tracks already on a different album would be moved off it - say so first.
    const moving = targets.filter((t) => t.album_id && t.album_id !== id).length;
    if (moving > 0) {
      const who =
        moving === targets.length
          ? moving === 1
            ? "This track is"
            : `All ${moving} of these tracks are`
          : `${moving} of these ${targets.length} tracks ${moving === 1 ? "is" : "are"}`;
      const them = moving === 1 ? "it" : "them";
      if (!window.confirm(`${who} on another album. Adding ${them} here will take ${them} off that album.\n\nContinue?`)) {
        return;
      }
    }
    setAddBusy(true);
    setAddMessage(null);
    let failed = 0;
    const done = new Set<string>();
    await runPool(targets, 4, async (t) => {
      try {
        await studioApi.updateTrack(t.id, { album_id: id });
        done.add(t.id);
      } catch {
        failed++;
      }
    });
    setAddBusy(false);
    // Anything that failed stays ticked, so pressing the button again retries just those.
    setAddPick(new Set(targets.filter((t) => !done.has(t.id)).map((t) => t.id)));
    setAddMessage(
      `Added ${done.size} track${done.size === 1 ? "" : "s"} to ${album?.title ?? "this album"}${
        failed ? ` (${failed} failed - press the button again to retry those)` : ""
      }.`
    );
    load();
  };

  const startRename = () => {
    setTitleDraft(album?.title ?? "");
    setTitleError(null);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    if (!id || titleBusy) return;
    const title = titleDraft.trim();
    if (!title) return setTitleError("The album needs a title.");
    if (title === album.title) return setEditingTitle(false);
    setTitleBusy(true);
    setTitleError(null);
    try {
      await studioApi.updateAlbum(id, { title });
      setEditingTitle(false);
      await load();
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Couldn't save the new title - please try again.");
    } finally {
      setTitleBusy(false);
    }
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
          {editingTitle ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  autoFocus
                  value={titleDraft}
                  aria-label="Album title"
                  style={{ fontSize: "1.4rem", minWidth: 280 }}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                />
                <button className="btn primary" onClick={saveTitle} disabled={titleBusy || !titleDraft.trim()}>
                  {titleBusy ? "Saving..." : "Save title"}
                </button>
                <button className="btn" onClick={() => setEditingTitle(false)} disabled={titleBusy}>
                  Cancel
                </button>
              </div>
              {titleError && <p style={{ color: "var(--accent)", margin: "6px 0 0", fontSize: "0.85rem" }}>{titleError}</p>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
              <h1 style={{ marginTop: 0, marginBottom: 0 }}>{album.title}</h1>
              <button className="btn" onClick={startRename} title="Change this album's title">
                Rename
              </button>
            </div>
          )}
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
        <h4 style={{ marginTop: 0 }}>Add tracks to this album</h4>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <input
            type="search"
            placeholder="Search title or artist..."
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9rem" }}>
            <input type="checkbox" checked={onlyNoAlbum} onChange={(e) => setOnlyNoAlbum(e.target.checked)} />
            Only tracks with no album
          </label>
          <span style={{ flex: 1 }} />
          <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
            {addPick.size} ticked · {addable.length} shown
          </span>
          <button
            className="btn"
            onClick={() => setAddPick((prev) => new Set([...prev, ...addable.map((t) => t.id)]))}
            disabled={addable.length === 0}
          >
            Tick all shown
          </button>
          <button className="btn" onClick={() => setAddPick(new Set())} disabled={addPick.size === 0}>
            Clear
          </button>
        </div>

        <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          {addable.map((t) => (
            <label
              key={t.id}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: "6px 10px",
                cursor: "pointer",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <input type="checkbox" checked={addPick.has(t.id)} onChange={() => toggleAddPick(t.id)} />
              <span style={{ flex: 1 }}>
                {t.title}
                {t.artist ? <span style={{ color: "var(--text-dim)" }}> - {t.artist}</span> : null}
              </span>
              <span style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>{t.album_title ?? "no album"}</span>
              {t.status !== "published" && <span className="badge">{t.status}</span>}
            </label>
          ))}
          {addable.length === 0 && (
            <p style={{ color: "var(--text-dim)", margin: 0, padding: 12 }}>
              {onlyNoAlbum
                ? "No tracks without an album match. Untick \"Only tracks with no album\" to see tracks on other albums."
                : "No other tracks match."}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={addPicked} disabled={addBusy || addPick.size === 0}>
            {addBusy
              ? "Adding..."
              : addPick.size === 0
                ? "Tick tracks to add them"
                : `Add ${addPick.size} track${addPick.size === 1 ? "" : "s"} to this album`}
          </button>
          {addMessage && <span style={{ fontSize: "0.85rem" }}>{addMessage}</span>}
        </div>
      </div>
    </div>
  );
}
