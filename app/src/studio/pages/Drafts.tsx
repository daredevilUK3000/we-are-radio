import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";
import { MOOD_OPTIONS } from "../lib/presets";
import { runPool } from "../lib/bulkImport";

/**
 * Draft tracks (everything imported but not yet live). Every field stays
 * editable here right up until a track is published, and publishing is a
 * deliberate step - per track, or for a selected group.
 */

const tagsOf = (t: any): string[] => (t.tag_names ? String(t.tag_names).split(",") : []);

const DraftRow = memo(function DraftRow({
  track,
  albums,
  selected,
  playing,
  onToggle,
  onPlay,
  onSave,
  onTags,
  onPublish,
  onDelete,
}: {
  track: any;
  albums: any[];
  selected: boolean;
  playing: boolean;
  onToggle: (id: string) => void;
  onPlay: (id: string) => void;
  onSave: (id: string, patch: Record<string, unknown>) => void;
  onTags: (id: string, tags: string[]) => void;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(track.title ?? "");
  const [artist, setArtist] = useState(track.artist ?? "");
  const [number, setNumber] = useState(track.track_number ? String(track.track_number) : "");
  const [editingTags, setEditingTags] = useState(false);
  const tags = tagsOf(track);

  // Keep the boxes in step if the track changes underneath (a bulk edit).
  useEffect(() => setTitle(track.title ?? ""), [track.title]);
  useEffect(() => setArtist(track.artist ?? ""), [track.artist]);
  useEffect(() => setNumber(track.track_number ? String(track.track_number) : ""), [track.track_number]);

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(track.title ?? ""); // a track can't lose its title
    if (t !== track.title) onSave(track.id, { title: t });
  };

  return (
    <>
      <tr className={`bi-row${selected ? " selected" : ""}${playing ? " playing" : ""}`}>
        <td>
          <input type="checkbox" checked={selected} onChange={() => onToggle(track.id)} aria-label={`Select ${track.title}`} />
        </td>
        <td>
          <button className="btn bi-play" onClick={() => onPlay(track.id)} aria-label={playing ? "Stop" : `Play ${track.title}`}>
            {playing ? "■" : "▶"}
          </button>
        </td>
        <td>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle} aria-label="Title" />
        </td>
        <td>
          <input
            value={artist}
            placeholder="Artist"
            onChange={(e) => setArtist(e.target.value)}
            onBlur={() => artist.trim() !== (track.artist ?? "") && onSave(track.id, { artist: artist.trim() || null })}
            aria-label="Artist"
          />
        </td>
        <td>
          <select
            value={track.album_id ?? ""}
            onChange={(e) => onSave(track.id, { album_id: e.target.value || null })}
            aria-label="Album"
          >
            <option value="">(no album)</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </td>
        <td>
          <input
            value={number}
            inputMode="numeric"
            placeholder="#"
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onBlur={() => {
              const n = number ? Number(number) : null;
              if (n !== (track.track_number ?? null)) onSave(track.id, { track_number: n });
            }}
            aria-label="Track number"
          />
        </td>
        <td>
          <button className="btn" onClick={() => setEditingTags((v) => !v)} title="Edit tags">
            {tags.length > 0 ? tags.join(", ") : "add tags"}
          </button>
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="btn primary" onClick={() => onPublish(track.id)}>
            Publish
          </button>{" "}
          <button className="btn" onClick={() => onDelete(track.id)}>
            Delete
          </button>
        </td>
      </tr>
      {editingTags && (
        <tr>
          <td colSpan={8} style={{ paddingTop: 0 }}>
            <ChipPicker options={MOOD_OPTIONS} value={tags} onChange={(next) => onTags(track.id, next)} />
          </td>
        </tr>
      )}
    </>
  );
});

export function Drafts() {
  const [tracks, setTracks] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [albumFilter, setAlbumFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [albumChoice, setAlbumChoice] = useState("");
  const [tagPick, setTagPick] = useState<string[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    const [t, a] = await Promise.all([studioApi.tracksByStatus("draft"), studioApi.albums()]);
    setTracks(t.tracks);
    setAlbums(a.albums);
    setLoaded(true);
  }, []);
  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tracks.filter(
      (t) =>
        (albumFilter === "all" || (albumFilter === "none" ? !t.album_id : t.album_id === albumFilter)) &&
        (!q || t.title.toLowerCase().includes(q) || (t.artist ?? "").toLowerCase().includes(q))
    );
  }, [tracks, search, albumFilter]);

  const onSave = useCallback(async (id: string, patch: Record<string, unknown>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await studioApi.updateTrack(id, patch);
    } catch {
      setMessage("Couldn't save that change - please try again.");
      void load();
    }
  }, [load]);

  const onTags = useCallback(async (id: string, tags: string[]) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, tag_names: tags.join(",") } : t)));
    try {
      await studioApi.setTrackTags(id, tags);
    } catch {
      setMessage("Couldn't save the tags - please try again.");
      void load();
    }
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const playingRef = useRef<string | null>(null);
  const play = useCallback((id: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingRef.current === id) {
      audio.pause();
      playingRef.current = null;
      setPlayingId(null);
      return;
    }
    const track = tracksRef.current.find((t) => t.id === id);
    if (!track) return;
    audio.src = mediaUrl(track.audio_url);
    audio.play().catch(() => {});
    playingRef.current = id;
    setPlayingId(id);
  }, []);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const publishIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    setMessage(null);
    let done = 0;
    await runPool(ids, 4, async (id) => {
      try {
        await studioApi.updateTrack(id, { status: "published" });
        done++;
      } catch {
        // counted below as not published
      }
    });
    setBusy(false);
    setSelected(new Set());
    setMessage(`Published ${done} track${done === 1 ? "" : "s"}${done < ids.length ? ` (${ids.length - done} failed - try those again)` : ""}.`);
    await load();
  };

  const deleteIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length === 1 ? "this draft" : `these ${ids.length} drafts`}? This can't be undone.`)) return;
    setBusy(true);
    let done = 0;
    await runPool(ids, 4, async (id) => {
      try {
        await studioApi.deleteTrack(id);
        done++;
      } catch {
        // counted below
      }
    });
    setBusy(false);
    setSelected(new Set());
    setMessage(`Deleted ${done} draft${done === 1 ? "" : "s"}${done < ids.length ? ` (${ids.length - done} couldn't be deleted)` : ""}.`);
    await load();
  };

  const selectedIds = tracks.filter((t) => selected.has(t.id)).map((t) => t.id);

  const bulkAlbum = async () => {
    if (!albumChoice || selectedIds.length === 0) return;
    setBusy(true);
    await runPool(selectedIds, 4, async (id) => {
      await studioApi.updateTrack(id, { album_id: albumChoice }).catch(() => {});
    });
    setBusy(false);
    setMessage(`Assigned ${selectedIds.length} track${selectedIds.length === 1 ? "" : "s"} to the album.`);
    await load();
  };

  const bulkTag = async () => {
    if (tagPick.length === 0 || selectedIds.length === 0) return;
    setBusy(true);
    await runPool(selectedIds, 4, async (id) => {
      const t = tracksRef.current.find((x) => x.id === id);
      const merged = Array.from(new Set([...(t ? tagsOf(t) : []), ...tagPick]));
      await studioApi.setTrackTags(id, merged).catch(() => {});
    });
    setBusy(false);
    setMessage(`Added ${tagPick.join(", ")} to ${selectedIds.length} track${selectedIds.length === 1 ? "" : "s"}.`);
    await load();
  };

  return (
    <div className="bi-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Drafts</h1>
        <Link to="/studio/bulk-import" className="btn primary">
          Bulk Import
        </Link>
      </div>
      <p style={{ color: "var(--text-dim)" }}>
        {loaded ? `${tracks.length} draft track${tracks.length === 1 ? "" : "s"}` : "Loading..."}. Nothing here is live: change
        anything you like - title, artist, album, number, tags - and publish when a track is ready. Only published tracks reach
        listeners and the channels.
      </p>

      <div className="card bi-card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search title or artist..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          <select value={albumFilter} onChange={(e) => setAlbumFilter(e.target.value)} aria-label="Album filter">
            <option value="all">All albums</option>
            <option value="none">No album</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set(visible.map((t) => t.id)))} disabled={visible.length === 0}>
            Select all shown ({visible.length})
          </button>
          <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            Clear
          </button>
        </div>

        <div className="bi-action" style={{ marginTop: 12 }}>
          <label>{selected.size} selected</label>
          <select value={albumChoice} onChange={(e) => setAlbumChoice(e.target.value)} aria-label="Assign album">
            <option value="">Assign to album...</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={bulkAlbum} disabled={busy || !albumChoice || selected.size === 0}>
            Assign album
          </button>
          <button
            className="btn primary"
            disabled={busy || selected.size === 0}
            onClick={() => {
              if (window.confirm(`Publish ${selected.size} track${selected.size === 1 ? "" : "s"}? They will go live to listeners and channels.`)) {
                void publishIds(selectedIds);
              }
            }}
          >
            Publish selected
          </button>
          <button className="btn" disabled={busy || selected.size === 0} onClick={() => deleteIds(selectedIds)}>
            Delete selected
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
          <span style={{ color: "var(--text-dim)", marginRight: 4 }}>Add tags to selected:</span>
          {MOOD_OPTIONS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`chip${tagPick.includes(tag) ? " selected" : ""}`}
              onClick={() => setTagPick((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]))}
            >
              {tag}
            </button>
          ))}
          <button className="btn" onClick={bulkTag} disabled={busy || tagPick.length === 0 || selected.size === 0}>
            Add
          </button>
        </div>
        {message && <p style={{ margin: "10px 0 0", fontSize: "0.85rem" }}>{message}</p>}
      </div>

      <div className="card bi-card" style={{ padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="bi-grid">
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: 64 }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: 170 }} />
            </colgroup>
            <thead>
              <tr>
                <th></th>
                <th></th>
                <th>Title</th>
                <th>Artist</th>
                <th>Album</th>
                <th>Track</th>
                <th>Tags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <DraftRow
                  key={t.id}
                  track={t}
                  albums={albums}
                  selected={selected.has(t.id)}
                  playing={playingId === t.id}
                  onToggle={toggle}
                  onPlay={play}
                  onSave={onSave}
                  onTags={onTags}
                  onPublish={(id) => void publishIds([id])}
                  onDelete={(id) => void deleteIds([id])}
                />
              ))}
              {loaded && visible.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--text-dim)" }}>
                    {tracks.length === 0 ? (
                      <>
                        No drafts. Tracks you upload from <Link to="/studio/bulk-import">Bulk Import</Link> land here.
                      </>
                    ) : (
                      "Nothing matches that filter."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <audio
        ref={audioRef}
        style={{ display: "none" }}
        onEnded={() => {
          playingRef.current = null;
          setPlayingId(null);
        }}
      />
    </div>
  );
}
