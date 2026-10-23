import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";
import { AlbumPlaces, PlaceDatalists, PlaceInputs, placeDraftOf, placePayload, samePlace, type PlaceDraft } from "../components/PlaceFields";

// Same song twice: identical audio (the upload fingerprint), or the same title
// by the same artist once case and spacing are ignored.
const sameSongKey = (t: any) => `${String(t.title ?? "").toLowerCase().replace(/\s+/g, " ").trim()}|${String(t.artist ?? "").toLowerCase().trim()}`;

export function Tracks() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyDupes, setOnlyDupes] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [artistDraft, setArtistDraft] = useState("");
  const [placeDraft, setPlaceDraft] = useState<PlaceDraft>(placeDraftOf({}));
  const [showAlbumPlaces, setShowAlbumPlaces] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => studioApi.tracks().then((r) => setTracks(r.tracks));
  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await studioApi.updateTrack(id, { status });
    load();
  };

  // For each track that has a twin, a short note saying which.
  const dupNotes = useMemo(() => {
    const byHash = new Map<string, any[]>();
    const bySong = new Map<string, any[]>();
    for (const t of tracks) {
      if (t.content_hash) byHash.set(t.content_hash, [...(byHash.get(t.content_hash) ?? []), t]);
      bySong.set(sameSongKey(t), [...(bySong.get(sameSongKey(t)) ?? []), t]);
    }
    const notes = new Map<string, string>();
    for (const t of tracks) {
      const sameAudio = (t.content_hash ? byHash.get(t.content_hash)! : []).filter((x) => x.id !== t.id);
      const sameName = bySong.get(sameSongKey(t))!.filter((x) => x.id !== t.id && !sameAudio.includes(x));
      if (sameAudio.length > 0) notes.set(t.id, `Same audio as ${sameAudio.length === 1 ? "another track" : `${sameAudio.length} other tracks`}`);
      else if (sameName.length > 0) notes.set(t.id, `Same title${t.artist ? " and artist" : ""} as ${sameName.length === 1 ? "another track" : `${sameName.length} other tracks`}`);
    }
    return notes;
  }, [tracks]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tracks.filter(
      (t) =>
        (!onlyDupes || dupNotes.has(t.id)) &&
        (!q ||
          String(t.title ?? "").toLowerCase().includes(q) ||
          String(t.artist ?? "").toLowerCase().includes(q) ||
          String(t.album_title ?? "").toLowerCase().includes(q))
    );
    // Duplicates side by side, so the copies can be compared and one deleted.
    return onlyDupes ? [...list].sort((a, b) => sameSongKey(a).localeCompare(sameSongKey(b))) : list;
  }, [tracks, search, onlyDupes, dupNotes]);

  const startRename = (t: any) => {
    setEditingId(t.id);
    setTitleDraft(t.title ?? "");
    setArtistDraft(t.artist ?? "");
    setPlaceDraft(placeDraftOf(t));
    setMessage(null);
  };

  const saveRename = async (t: any) => {
    const title = titleDraft.trim();
    if (!title) return setMessage("A track needs a title.");
    const artist = artistDraft.trim() || null;
    const nameChanged = title !== t.title || artist !== (t.artist ?? null);
    const placeChanged = !samePlace(placeDraft, placeDraftOf(t));
    if (!nameChanged && !placeChanged) return setEditingId(null);
    setBusyId(t.id);
    try {
      if (nameChanged) await studioApi.updateTrack(t.id, { title, artist });
      if (placeChanged) await studioApi.setTrackPlaces([placePayload(t.id, placeDraft)]);
      setEditingId(null);
      setMessage(`Saved "${title}".`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't save the changes - please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t: any) => {
    const live = t.status === "published" ? "\n\nIt is published, so it will stop playing on the radio and disappear from the site." : "";
    if (!window.confirm(`Delete "${t.title}"${t.album_title ? ` (on ${t.album_title})` : ""}?${live}\n\nThis can't be undone.`)) return;
    setBusyId(t.id);
    setMessage(null);
    try {
      await studioApi.deleteTrack(t.id);
      if (playingId === t.id) setPlayingId(null);
      setMessage(`Deleted "${t.title}".`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't delete that track - please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Tracks</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setShowAlbumPlaces((v) => !v)}>
            Places for an album
          </button>
          <Link to="/studio/tracks/upload" className="btn primary">
            Upload music
          </Link>
        </div>
      </div>
      <PlaceDatalists />
      {showAlbumPlaces && (
        <AlbumPlaces
          tracks={tracks}
          onClose={() => setShowAlbumPlaces(false)}
          onSaved={(m) => {
            setMessage(m);
            void load();
          }}
        />
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search title, artist or album..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9rem" }}>
          <input type="checkbox" checked={onlyDupes} onChange={(e) => setOnlyDupes(e.target.checked)} />
          Only possible duplicates ({dupNotes.size})
        </label>
        <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          {shown.length} of {tracks.length} shown
        </span>
      </div>
      {message && <p style={{ fontSize: "0.9rem" }}>{message}</p>}
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th>Album</th>
            <th>Genre</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <td style={{ width: 48 }}>
                  {t.artwork_url ? (
                    <img
                      src={mediaUrl(t.artwork_url)}
                      alt=""
                      width={40}
                      height={40}
                      style={{ objectFit: "cover", borderRadius: 4, display: "block" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 4,
                        background: "var(--bg-raised)",
                        border: "1px solid var(--border)",
                      }}
                    />
                  )}
                </td>
                <td>
                  {editingId === t.id ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        autoFocus
                        value={titleDraft}
                        aria-label="Title"
                        placeholder="Title"
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(t);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <input
                        value={artistDraft}
                        aria-label="Artist"
                        placeholder="Artist"
                        style={{ maxWidth: 180 }}
                        onChange={(e) => setArtistDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(t);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexBasis: "100%" }}>
                        <PlaceInputs
                          value={placeDraft}
                          onChange={setPlaceDraft}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename(t);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      </div>
                      <button className="btn primary" onClick={() => saveRename(t)} disabled={busyId === t.id || !titleDraft.trim()}>
                        {busyId === t.id ? "Saving..." : "Save"}
                      </button>
                      <button className="btn" onClick={() => setEditingId(null)} disabled={busyId === t.id}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      {t.title}
                      {t.artist ? <span style={{ color: "var(--text-dim)" }}> - {t.artist}</span> : null}
                      {t.place_city ? (
                        <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
                          {t.place_city}
                          {t.place_country ? `, ${t.place_country}` : ""}
                          {t.place_timezone ? ` (${t.place_timezone})` : ""}
                        </div>
                      ) : null}
                      {dupNotes.has(t.id) && (
                        <span
                          className="badge"
                          style={{ color: "#f0a12a", borderColor: "#f0a12a", marginLeft: 8 }}
                          title={dupNotes.get(t.id)}
                        >
                          Duplicate?
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td style={{ color: "var(--text-dim)" }}>{t.album_title ?? ""}</td>
                <td>{t.genre}</td>
                <td>
                  <span className="badge">{t.status}</span>
                </td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  {editingId !== t.id && (
                    <button className="btn" onClick={() => startRename(t)} disabled={busyId === t.id}>
                      Edit
                    </button>
                  )}
                  <button className="btn" onClick={() => remove(t)} disabled={busyId === t.id}>
                    Delete
                  </button>
                </td>
              </tr>
              {playingId === t.id && (
                <tr>
                  <td colSpan={6} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(t.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--text-dim)" }}>
                {tracks.length === 0 ? "Nothing uploaded yet." : onlyDupes ? "No duplicates found." : "No tracks match."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
