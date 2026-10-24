import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl, type ChannelSongs, type SongIntro } from "../../api/client";
import { AlbumPlaces, PlaceDatalists, PlaceInputs, placeDraftOf, placePayload, samePlace, type PlaceDraft } from "../components/PlaceFields";
import { ImportIntros } from "../components/ImportIntros";

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Export songs (handoff_import_intros.md §4): the songs shown, for the Intro Maker app. */
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  // The byte-order mark keeps accents right when the file is opened in Excel.
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const introSummary = (i: SongIntro) =>
  !i.enabled ? "Intro off" : i.play_mode === "over" ? `Intro over the opening, ${i.start_offset_seconds} s in` : "Intro before the song";

/** A song's intro: hear it, read its script, and choose how it plays (handoff_import_intros.md §3.2). */
function IntroSettings({
  intro,
  busy,
  onChange,
  onRemove,
}: {
  intro: SongIntro;
  busy: boolean;
  onChange: (data: { play_mode?: "before" | "over"; start_offset_seconds?: number; enabled?: boolean }) => void;
  onRemove: () => void;
}) {
  const [offset, setOffset] = useState(String(intro.start_offset_seconds));
  useEffect(() => setOffset(String(intro.start_offset_seconds)), [intro.start_offset_seconds]);
  const saveOffset = () => {
    const v = Math.round(Number(offset));
    if (Number.isFinite(v) && v >= 0 && v <= 120 && v !== intro.start_offset_seconds) onChange({ start_offset_seconds: v });
    else setOffset(String(intro.start_offset_seconds));
  };
  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <audio controls src={mediaUrl(intro.audio_url)} style={{ width: "100%" }} />
      {intro.description && <p style={{ margin: 0, fontStyle: "italic" }}>“{intro.description}”</p>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!intro.enabled} disabled={busy} onChange={(e) => onChange({ enabled: e.target.checked })} />
          Play this intro
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name={`intro-mode-${intro.track_id}`}
            checked={intro.play_mode === "before"}
            disabled={busy}
            onChange={() => onChange({ play_mode: "before" })}
          />
          Before the song
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name={`intro-mode-${intro.track_id}`}
            checked={intro.play_mode === "over"}
            disabled={busy}
            onChange={() => onChange({ play_mode: "over" })}
          />
          Over the opening (music dipped)
        </label>
        {intro.play_mode === "over" && (
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            starting
            <input
              type="number"
              min={0}
              max={120}
              value={offset}
              disabled={busy}
              onChange={(e) => setOffset(e.target.value)}
              onBlur={saveOffset}
              onKeyDown={(e) => e.key === "Enter" && saveOffset()}
              style={{ width: 70 }}
            />
            seconds in
          </label>
        )}
        <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>{Math.round(intro.duration_seconds)} s long</span>
        <button className="btn" onClick={onRemove} disabled={busy} style={{ marginLeft: "auto" }}>
          Remove intro
        </button>
      </div>
      {intro.play_mode === "over" && (
        <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Only sounds right when the song opens with music and no singing for at least as long as the intro.
        </p>
      )}
    </div>
  );
}

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
  // Song intros (migrations/0030) and the songs each channel plays (routes/intros.ts).
  const [intros, setIntros] = useState<Map<string, SongIntro>>(new Map());
  const [channels, setChannels] = useState<ChannelSongs[]>([]);
  const [albumFilter, setAlbumFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [onlyIntro, setOnlyIntro] = useState<"" | "with" | "without">("");
  const [showImport, setShowImport] = useState(false);
  const [introOpenId, setIntroOpenId] = useState<string | null>(null);

  const load = () => studioApi.tracks().then((r) => setTracks(r.tracks));
  const loadIntros = () =>
    studioApi
      .intros()
      .then((r) => {
        setIntros(new Map(r.intros.map((i) => [i.track_id, i])));
        setChannels(r.channels);
      })
      .catch(() => {});
  useEffect(() => {
    load();
    loadIntros();
  }, []);

  const channelsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ch of channels) for (const id of ch.track_ids) m.set(id, [...(m.get(id) ?? []), ch.name]);
    return m;
  }, [channels]);

  const albums = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tracks) if (t.album_id) m.set(t.album_id, t.album_title ?? "Untitled album");
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tracks]);

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
    const inChannel = channelFilter ? new Set(channels.find((c) => c.id === channelFilter)?.track_ids ?? []) : null;
    const list = tracks.filter(
      (t) =>
        (!onlyDupes || dupNotes.has(t.id)) &&
        (!albumFilter || t.album_id === albumFilter) &&
        (!inChannel || inChannel.has(t.id)) &&
        (!onlyIntro || (onlyIntro === "with") === intros.has(t.id)) &&
        (!q ||
          String(t.title ?? "").toLowerCase().includes(q) ||
          String(t.artist ?? "").toLowerCase().includes(q) ||
          String(t.album_title ?? "").toLowerCase().includes(q))
    );
    // Duplicates side by side, so the copies can be compared and one deleted.
    return onlyDupes ? [...list].sort((a, b) => sameSongKey(a).localeCompare(sameSongKey(b))) : list;
  }, [tracks, search, onlyDupes, dupNotes, albumFilter, channelFilter, channels, onlyIntro, intros]);

  // Export songs: the songs shown, with the columns the handoff lists (id first, as the Intro Maker app reads it).
  const exportCsv = () => {
    const header = ["id", "title", "album", "channel(s)", "city", "country", "duration_seconds", "has_intro"];
    const rows = shown.map((t) => [
      t.id,
      t.title,
      t.album_title ?? "",
      (channelsOf.get(t.id) ?? []).join("; "),
      t.place_city ?? "",
      t.place_country ?? "",
      t.duration_seconds,
      intros.has(t.id) ? "yes" : "no",
    ]);
    const what = channelFilter
      ? channels.find((c) => c.id === channelFilter)?.slug
      : albumFilter
        ? albums.find(([id]) => id === albumFilter)?.[1]
        : "all";
    const slug = String(what ?? "songs").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "songs";
    downloadCsv(`songs-${slug}.csv`, [header, ...rows]);
  };

  const changeIntro = async (trackId: string, data: { play_mode?: "before" | "over"; start_offset_seconds?: number; enabled?: boolean }) => {
    setBusyId(trackId);
    try {
      await studioApi.updateIntro(trackId, data);
      await loadIntros();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't change the intro - please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const removeIntro = async (t: any) => {
    if (!window.confirm(`Remove the intro from "${t.title}"?\n\nIts recording is deleted too. You can import it again later.`)) return;
    setBusyId(t.id);
    try {
      await studioApi.deleteIntro(t.id);
      setIntroOpenId(null);
      setMessage(`Removed the intro from "${t.title}".`);
      await loadIntros();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't remove the intro - please try again.");
    } finally {
      setBusyId(null);
    }
  };

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
          <button className="btn" onClick={exportCsv} disabled={shown.length === 0} title="The songs shown below, as a CSV file for the Intro Maker app">
            Export CSV
          </button>
          <button className="btn" onClick={() => setShowImport((v) => !v)}>
            Import intros
          </button>
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
      {showImport && (
        <ImportIntros
          tracks={tracks}
          intros={intros}
          onClose={() => setShowImport(false)}
          onImported={(m) => {
            setShowImport(false);
            setMessage(m);
            void loadIntros();
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
        <select value={albumFilter} onChange={(e) => setAlbumFilter(e.target.value)} aria-label="Album" style={{ maxWidth: 220 }}>
          <option value="">All albums</option>
          {albums.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Channel" style={{ maxWidth: 220 }}>
          <option value="">All channels</option>
          {channels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.name}
              {ch.status !== "live" ? ` (${ch.status})` : ""}
            </option>
          ))}
        </select>
        <select value={onlyIntro} onChange={(e) => setOnlyIntro(e.target.value as "" | "with" | "without")} aria-label="Intro">
          <option value="">With or without an intro</option>
          <option value="with">With an intro ({intros.size})</option>
          <option value="without">Without an intro</option>
        </select>
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
                      {intros.has(t.id) && (
                        <div style={{ color: intros.get(t.id)!.enabled ? "#8b5cf6" : "var(--text-dim)", fontSize: "0.8rem" }}>
                          🎙 {introSummary(intros.get(t.id)!)}
                        </div>
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
                  {intros.has(t.id) && (
                    <button className="btn" onClick={() => setIntroOpenId(introOpenId === t.id ? null : t.id)} aria-expanded={introOpenId === t.id}>
                      {introOpenId === t.id ? "Close intro" : "Intro"}
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
              {introOpenId === t.id && intros.has(t.id) && (
                <tr>
                  <td colSpan={6} style={{ paddingTop: 0 }}>
                    <IntroSettings
                      intro={intros.get(t.id)!}
                      busy={busyId === t.id}
                      onChange={(data) => changeIntro(t.id, data)}
                      onRemove={() => removeIntro(t)}
                    />
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
