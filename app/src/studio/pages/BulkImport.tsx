import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";
import { MOOD_OPTIONS } from "../lib/presets";
import {
  fileKeyOf,
  humanSize,
  isAudioFile,
  naturalCompare,
  readDuration,
  runPool,
  sha256Hex,
  titleFromFilename,
  uploadWithProgress,
} from "../lib/bulkImport";

/**
 * Bulk Import: turn a folder of unlabelled audio into draft tracks.
 *
 * Nothing is guessed from the files - every title is typed by hand - so the
 * page is built to make that fast: listen in the row, type, press Enter (which
 * jumps to the next row and plays it). What is typed is saved to the server as
 * it goes and comes back when the same folder is picked again, so a 400-track
 * job can be done across several sittings. Uploads go 5 at a time, in chunks,
 * and every uploaded file becomes a DRAFT track that stays fully editable.
 */

interface Row {
  key: string;
  file: File;
  filename: string;
  path: string;
  title: string;
  artist: string;
  albumId: string;
  trackNumber: string;
  tags: string[];
  hash?: string;
  hashFailed?: boolean;
  trackId?: string; // set once uploaded: the draft track made for this file
  upload: "idle" | "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  rev: number; // bumped on every edit, so a save only clears what it actually sent
  dirty: boolean;
}

interface Settings {
  artist: string;
  autoplay: boolean;
  playFrom: "start" | "quarter" | "middle";
  snippet: boolean;
  tidyCaps: boolean;
}

const SETTINGS_KEY = "we-are-radio:bulk-import-settings";
const DEFAULT_SETTINGS: Settings = { artist: "", autoplay: true, playFrom: "quarter", snippet: true, tidyCaps: true };
const UPLOAD_WAVE = 25; // files per batch of presigned URLs
const UPLOAD_LANES = 5; // uploads in flight at once
const SNIPPET_SECONDS = 20;

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function parseTags(raw: unknown): string[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------- a row

const RowView = memo(function RowView({
  row,
  index,
  selected,
  playing,
  albums,
  dupNote,
  registerTitle,
  onSelect,
  onPlay,
  onEdit,
  onEnter,
  onPasteTitles,
  onRetry,
}: {
  row: Row;
  index: number;
  selected: boolean;
  playing: boolean;
  albums: any[];
  dupNote?: string;
  registerTitle: (key: string, el: HTMLInputElement | null) => void;
  onSelect: (key: string, shift: boolean) => void;
  onPlay: (key: string) => void;
  onEdit: (key: string, patch: Partial<Row>) => void;
  onEnter: (key: string, direction: 1 | -1, play: boolean) => void;
  onPasteTitles: (key: string, text: string) => boolean;
  onRetry: (key: string) => void;
}) {
  const uploaded = row.upload === "done";

  return (
    <tr className={`bi-row${playing ? " playing" : ""}${selected ? " selected" : ""}`}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${row.filename}`}
          onChange={() => undefined}
          onClick={(e) => onSelect(row.key, e.shiftKey)}
        />
      </td>
      <td className="bi-num">{index + 1}</td>
      <td>
        <button
          className="btn bi-play"
          onClick={() => onPlay(row.key)}
          aria-label={playing ? `Stop ${row.filename}` : `Play ${row.filename}`}
          title={playing ? "Stop" : "Play a snippet"}
        >
          {playing ? "■" : "▶"}
        </button>
      </td>
      <td className="bi-file" title={row.path}>
        {row.filename}
      </td>
      <td>
        <input
          ref={(el) => registerTitle(row.key, el)}
          value={row.title}
          placeholder="Title"
          aria-label={`Title for ${row.filename}`}
          onChange={(e) => onEdit(row.key, { title: e.target.value })}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\r\n]/.test(text.replace(/[\r\n]+$/, "")) && onPasteTitles(row.key, text)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter(row.key, e.shiftKey ? -1 : 1, true);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onEnter(row.key, 1, false);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              onEnter(row.key, -1, false);
            } else if (e.key === " " && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onPlay(row.key);
            }
          }}
        />
      </td>
      <td>
        <input
          value={row.artist}
          placeholder="Artist"
          aria-label={`Artist for ${row.filename}`}
          onChange={(e) => onEdit(row.key, { artist: e.target.value })}
        />
      </td>
      <td>
        <select
          value={row.albumId}
          aria-label={`Album for ${row.filename}`}
          onChange={(e) => onEdit(row.key, { albumId: e.target.value })}
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
          value={row.trackNumber}
          inputMode="numeric"
          placeholder="#"
          aria-label={`Track number for ${row.filename}`}
          onChange={(e) => onEdit(row.key, { trackNumber: e.target.value.replace(/\D/g, "").slice(0, 3) })}
        />
      </td>
      <td className="bi-status">
        {row.upload === "uploading" && (
          <span className="bi-progress" title={`${row.progress}%`}>
            <span style={{ width: `${row.progress}%` }} />
          </span>
        )}
        {row.upload === "queued" && <span className="badge">Queued</span>}
        {uploaded && (
          <span className="badge live" title="Uploaded as a draft track - still fully editable">
            Draft ✓
          </span>
        )}
        {row.upload === "error" && (
          <span className="bi-error" title={row.error}>
            <span className="badge" style={{ color: "var(--accent)" }}>
              Failed
            </span>{" "}
            <button className="btn" onClick={() => onRetry(row.key)}>
              Retry
            </button>
          </span>
        )}
        {!uploaded && row.upload === "idle" && dupNote && (
          <span className="badge" style={{ color: "#f0a12a", borderColor: "#f0a12a" }} title={dupNote}>
            Duplicate?
          </span>
        )}
        {!uploaded && row.upload === "idle" && !dupNote && !row.title.trim() && (
          <span style={{ color: "#f0a12a", fontSize: "0.8rem" }}>needs a title</span>
        )}
        {!uploaded && row.upload === "idle" && !dupNote && row.title.trim() && (
          <span style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>ready</span>
        )}
      </td>
    </tr>
  );
});

// ------------------------------------------------------------------- the page

export function BulkImport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [albums, setAlbums] = useState<any[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [filter, setFilter] = useState<"all" | "needs-title" | "duplicates" | "not-uploaded" | "uploaded">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [retryTick, setRetryTick] = useState(0);
  const [summary, setSummary] = useState<{ typed_not_uploaded: number; uploaded: number; drafts: number } | null>(null);
  const [hashStatus, setHashStatus] = useState<string | null>(null);
  const [libraryDupes, setLibraryDupes] = useState<Map<string, { title: string; trackId: string }>>(new Map());
  const [channelHints, setChannelHints] = useState<Map<string, string[]>>(new Map());
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  // bulk-action inputs
  const [albumChoice, setAlbumChoice] = useState("");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [onlyBlank, setOnlyBlank] = useState(true);
  const [numberStart, setNumberStart] = useState(1);
  const [tagPick, setTagPick] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // upload run
  const [includeDupes, setIncludeDupes] = useState(false);
  const [run, setRun] = useState<{ active: boolean; total: number; done: number; failed: number } | null>(null);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const stopAt = useRef<number | null>(null);
  const playingKeyRef = useRef<string | null>(null);
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const anchorKey = useRef<string | null>(null);
  const hashing = useRef(false);
  const hashedKeys = useRef(new Set<string>());
  const flushing = useRef(false);
  const cancelRun = useRef(false);
  const visibleKeysRef = useRef<string[]>([]);

  // -------------------------------------------------------------- loading
  useEffect(() => {
    studioApi.albums().then((r) => setAlbums(r.albums)).catch(() => {});
    studioApi.bulkSummary().then(setSummary).catch(() => {});
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

    // Tracks uploaded before duplicate detection existed have no fingerprint
    // yet; give them one in the background (a few at a time).
    let cancelled = false;
    (async () => {
      for (let guard = 0; guard < 200 && !cancelled; guard++) {
        const r = await studioApi.bulkBackfill().catch(() => null);
        if (!r) return;
        if (r.remaining === 0) {
          setHashStatus(null);
          return;
        }
        setHashStatus(`Fingerprinting your existing library for duplicate checks (${r.remaining} to go)...`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // remembering the settings is a convenience only
    }
  }, [settings]);

  // -------------------------------------------------------------- editing
  const patchRow = useCallback((key: string, patch: Partial<Row>, edit = true) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch, ...(edit ? { rev: r.rev + 1, dirty: true } : {}) } : r))
    );
  }, []);

  const patchMany = useCallback((keys: Set<string>, fn: (r: Row) => Partial<Row>) => {
    setRows((prev) =>
      prev.map((r) => (keys.has(r.key) ? { ...r, ...fn(r), rev: r.rev + 1, dirty: true } : r))
    );
  }, []);

  // ------------------------------------------------ save as you go (debounced)
  const flush = useCallback(async () => {
    if (flushing.current) return;
    const dirty = rowsRef.current.filter((r) => r.dirty);
    if (dirty.length === 0) {
      setSaveState("saved");
      return;
    }
    flushing.current = true;
    setSaveState("saving");
    try {
      for (let i = 0; i < dirty.length; i += 25) {
        const chunk = dirty.slice(i, i + 25);
        await studioApi.bulkSave(
          chunk.map((r) => ({
            file_key: r.key,
            filename: r.filename,
            size_bytes: r.file.size,
            title: r.title,
            artist: r.artist,
            album_id: r.albumId || null,
            track_number: r.trackNumber ? Number(r.trackNumber) : null,
            tags: r.tags,
            content_hash: r.hash ?? null,
          }))
        );
        const sent = new Map(chunk.map((r) => [r.key, r.rev]));
        setRows((prev) => prev.map((r) => (sent.get(r.key) === r.rev ? { ...r, dirty: false } : r)));
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
      window.setTimeout(() => setRetryTick((n) => n + 1), 5000);
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!rows.some((r) => r.dirty)) return;
    setSaveState((s) => (s === "saving" ? s : "pending"));
    const timer = window.setTimeout(flush, 1200);
    return () => window.clearTimeout(timer);
  }, [rows, retryTick, flush]);

  // Leaving with unsaved edits or an upload running deserves a warning.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (run?.active || rowsRef.current.some((r) => r.dirty)) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [run?.active]);

  // -------------------------------------------------- choosing files/folders
  const startHashing = useCallback(async () => {
    if (hashing.current) return;
    hashing.current = true;
    try {
      for (;;) {
        const pending = rowsRef.current.filter((r) => !r.hash && !r.hashFailed && !hashedKeys.current.has(r.key));
        if (pending.length === 0) break;
        let checked: string[] = [];
        const checkLibrary = async () => {
          if (checked.length === 0) return;
          const hashes = checked;
          checked = [];
          try {
            const { matches } = await studioApi.bulkDuplicates(hashes);
            if (matches.length > 0) {
              setLibraryDupes((prev) => {
                const next = new Map(prev);
                for (const m of matches) next.set(m.hash, { title: m.title, trackId: m.track_id });
                return next;
              });
            }
          } catch {
            // the duplicate check is best-effort; uploading re-checks on the server
          }
        };
        for (let i = 0; i < pending.length; i++) {
          setHashStatus(`Fingerprinting files to spot duplicates (${i + 1} of ${pending.length})...`);
          const row = pending[i];
          hashedKeys.current.add(row.key);
          try {
            const hash = await sha256Hex(row.file);
            setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, hash } : r)));
            checked.push(hash);
            if (checked.length >= 20) await checkLibrary();
          } catch {
            setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, hashFailed: true } : r)));
          }
        }
        await checkLibrary();
      }
    } finally {
      hashing.current = false;
      setHashStatus(null);
      // Files added while this pass was finishing still need fingerprinting.
      if (rowsRef.current.some((r) => !r.hash && !r.hashFailed && !hashedKeys.current.has(r.key))) void startHashing();
    }
  }, []);

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const all = Array.from(fileList);
      const audio = all.filter(isAudioFile);
      const skipped = all.length - audio.length;

      const existing = new Set(rowsRef.current.map((r) => r.key));
      const fresh: Row[] = [];
      for (const file of audio) {
        const key = fileKeyOf(file);
        if (existing.has(key)) continue;
        existing.add(key);
        fresh.push({
          key,
          file,
          filename: file.name,
          path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          title: "",
          artist: settingsRef.current.artist,
          albumId: "",
          trackNumber: "",
          tags: [],
          upload: "idle",
          progress: 0,
          rev: 0,
          dirty: false,
        });
      }
      const already = audio.length - fresh.length;

      // Bring back whatever was typed for these files in an earlier sitting.
      let restored = 0;
      if (fresh.length > 0) {
        const saved = new Map<string, any>();
        for (let i = 0; i < fresh.length; i += 80) {
          try {
            const { rows: found } = await studioApi.bulkLookup(fresh.slice(i, i + 80).map((r) => r.key));
            for (const f of found) saved.set(f.file_key, f);
          } catch {
            // no saved progress available - start blank
          }
        }
        for (const row of fresh) {
          const s = saved.get(row.key);
          if (!s) continue;
          const hadContent = !!(s.title || s.track_id);
          row.title = s.title ?? "";
          row.artist = s.artist ?? row.artist;
          row.albumId = s.album_id ?? "";
          row.trackNumber = s.track_number ? String(s.track_number) : "";
          row.tags = parseTags(s.tags);
          row.hash = s.content_hash || undefined;
          if (s.track_id) {
            row.trackId = s.track_id;
            row.upload = "done";
            row.progress = 100;
          }
          if (hadContent) restored++;
        }
      }

      setRows((prev) =>
        [...prev, ...fresh].sort((a, b) => naturalCompare(a.path, b.path))
      );
      const parts = [`Added ${fresh.length} file${fresh.length === 1 ? "" : "s"}`];
      if (restored > 0) parts.push(`${restored} with titles restored from earlier`);
      if (already > 0) parts.push(`${already} already in the grid`);
      if (skipped > 0) parts.push(`${skipped} non-audio file${skipped === 1 ? "" : "s"} skipped`);
      setNotice(parts.join(" · "));
    },
    []
  );

  // Fingerprint new files once they are in the grid (an effect, so the row
  // list the hasher reads is the up-to-date one).
  useEffect(() => {
    if (rows.some((r) => !r.hash && !r.hashFailed && !hashedKeys.current.has(r.key))) void startHashing();
  }, [rows.length, startHashing]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------- derived
  const dupNotes = useMemo(() => {
    const out = new Map<string, string>();
    // Files already uploaded from this batch count as "in the library" too, so a
    // second copy of one is flagged even before the library list is refreshed.
    const firstSeen = new Map<string, string>();
    for (const r of rows) if (r.hash && r.trackId && !firstSeen.has(r.hash)) firstSeen.set(r.hash, r.filename);
    for (const r of rows) {
      if (!r.hash || r.trackId) continue;
      const lib = libraryDupes.get(r.hash);
      if (lib) {
        out.set(r.key, `Already in your library as "${lib.title}"`);
        continue;
      }
      const first = firstSeen.get(r.hash);
      if (first) out.set(r.key, `Same audio as "${first}" elsewhere in this batch`);
      else firstSeen.set(r.hash, r.filename);
    }
    return out;
  }, [rows, libraryDupes]);

  const visibleRows = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "needs-title") return !r.title.trim() && r.upload !== "done";
        if (filter === "duplicates") return dupNotes.has(r.key);
        if (filter === "uploaded") return r.upload === "done";
        if (filter === "not-uploaded") return r.upload !== "done";
        return true;
      }),
    [rows, filter, dupNotes]
  );
  visibleKeysRef.current = visibleRows.map((r) => r.key);
  const indexByKey = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  const isReady = (r: Row) =>
    r.upload !== "done" &&
    r.upload !== "uploading" &&
    r.upload !== "queued" &&
    !!r.title.trim() &&
    (includeDupes || !dupNotes.has(r.key));
  const readyRows = rows.filter(isReady);
  const selectedReady = rows.filter((r) => selected.has(r.key) && isReady(r));
  const counts = {
    total: rows.length,
    titled: rows.filter((r) => r.title.trim()).length,
    uploaded: rows.filter((r) => r.upload === "done").length,
    dupes: rows.filter((r) => dupNotes.has(r.key) && r.upload !== "done").length,
  };

  // -------------------------------------------------------------- selection
  const onSelect = useCallback((key: string, shift: boolean) => {
    const keys = visibleKeysRef.current;
    // Read the anchor now: the updater below runs later, after it has moved.
    const anchor = anchorKey.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor && keys.includes(anchor)) {
        const a = keys.indexOf(anchor);
        const b = keys.indexOf(key);
        const [from, to] = a < b ? [a, b] : [b, a];
        const turnOn = !prev.has(key);
        for (let i = from; i <= to; i++) (turnOn ? next.add(keys[i]) : next.delete(keys[i]));
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchorKey.current = key;
  }, []);

  const selectWhere = (pred: (r: Row) => boolean) => setSelected(new Set(visibleRows.filter(pred).map((r) => r.key)));

  // -------------------------------------------------------------- preview
  const stopPlayback = useCallback(() => {
    audioRef.current?.pause();
    playingKeyRef.current = null;
    setPlayingKey(null);
  }, []);

  const playRow = useCallback(
    (key: string) => {
      const audio = audioRef.current;
      const row = rowsRef.current.find((r) => r.key === key);
      if (!audio || !row) return;
      if (playingKeyRef.current === key && !audio.paused) {
        stopPlayback();
        return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(row.file);
      audio.src = objectUrl.current;
      playingKeyRef.current = key;
      setPlayingKey(key);
      stopAt.current = null;
      const s = settingsRef.current;
      audio.addEventListener(
        "loadedmetadata",
        () => {
          const d = audio.duration;
          if (Number.isFinite(d) && s.playFrom !== "start") {
            audio.currentTime = d * (s.playFrom === "quarter" ? 0.25 : 0.5);
          }
          stopAt.current = s.snippet ? audio.currentTime + SNIPPET_SECONDS : null;
        },
        { once: true }
      );
      audio.play().catch(() => stopPlayback());
    },
    [stopPlayback]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopPlayback();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      audioRef.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [stopPlayback]);

  // Enter = next row (and play it); Shift+Enter = previous; arrows just move.
  const onEnter = useCallback(
    (key: string, direction: 1 | -1, play: boolean) => {
      const keys = visibleKeysRef.current;
      const target = keys[keys.indexOf(key) + direction];
      if (!target) return;
      const input = titleInputs.current.get(target);
      input?.focus();
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (play && settingsRef.current.autoplay) playRow(target);
    },
    [playRow]
  );

  const registerTitle = useCallback((key: string, el: HTMLInputElement | null) => {
    if (el) titleInputs.current.set(key, el);
    else titleInputs.current.delete(key);
  }, []);

  // -------------------------------------------------------------- paste
  // A list of titles, one per line (optionally "title<TAB>artist"), fills the
  // title column downward from a starting row.
  const applyLines = useCallback(
    (startKey: string, text: string, onlyEmpty = false) => {
      const lines = text.replace(/\r/g, "").split("\n");
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      const keys = visibleKeysRef.current;
      const start = keys.indexOf(startKey);
      if (start < 0 || lines.length === 0) return 0;
      const updates = new Map<string, { title: string; artist?: string }>();
      let cursor = start;
      for (const line of lines) {
        while (onlyEmpty && cursor < keys.length) {
          const r = rowsRef.current.find((x) => x.key === keys[cursor]);
          if (r && !r.title.trim()) break;
          cursor++;
        }
        if (cursor >= keys.length) break;
        const [title, artist] = line.split("\t");
        if (title.trim()) updates.set(keys[cursor], { title: title.trim(), artist: artist?.trim() || undefined });
        cursor++;
      }
      setRows((prev) =>
        prev.map((r) => {
          const u = updates.get(r.key);
          return u
            ? { ...r, title: u.title, artist: u.artist ?? r.artist, rev: r.rev + 1, dirty: true }
            : r;
        })
      );
      setNotice(`Pasted ${updates.size} title${updates.size === 1 ? "" : "s"}${lines.length > updates.size ? ` (${lines.length - updates.size} blank line${lines.length - updates.size === 1 ? "" : "s"} skipped)` : ""}`);
      return updates.size;
    },
    []
  );

  // For folders whose file names ARE the titles: copy them into the blank
  // Title boxes (selected rows if any are selected, otherwise every row).
  const useFileNames = () => {
    const scope = selectedRef.current.size > 0 ? selectedRef.current : null;
    setRows((prev) =>
      prev.map((r) => {
        if (r.title.trim() || r.upload === "done" || (scope && !scope.has(r.key))) return r;
        const title = titleFromFilename(r.filename, settingsRef.current.tidyCaps);
        if (!title) return r;
        return { ...r, title, rev: r.rev + 1, dirty: true };
      })
    );
    // Count from the current rows for the message (the updater above runs later).
    const would = rowsRef.current.filter(
      (r) => !r.title.trim() && r.upload !== "done" && (!scope || scope.has(r.key))
    ).length;
    setNotice(
      would > 0
        ? `Filled ${would} title${would === 1 ? "" : "s"} from the file names${settingsRef.current.tidyCaps ? " (ALL CAPS tidied)" : ""}. Have a look and correct any before uploading.`
        : "Every row already has a title."
    );
  };

  const onPasteTitles = useCallback((key: string, text: string) => applyLines(key, text) > 0, [applyLines]);

  // -------------------------------------------------------------- bulk edits
  const targetKeys = (scope: "selected" | "all"): Set<string> =>
    scope === "all" ? new Set(rows.map((r) => r.key)) : new Set(selected);

  const applyArtist = (scope: "selected" | "all") => {
    const artist = settings.artist.trim();
    if (!artist) return;
    patchMany(targetKeys(scope), (r) => (onlyBlank && r.artist.trim() ? {} : { artist }));
  };

  const applyAlbum = (scope: "selected" | "all") => {
    if (!albumChoice) return;
    patchMany(targetKeys(scope), () => ({ albumId: albumChoice }));
  };

  const numberSelected = () => {
    const order = visibleRows.filter((r) => selected.has(r.key)).map((r) => r.key);
    const numbers = new Map(order.map((k, i) => [k, String(numberStart + i)]));
    patchMany(new Set(order), (r) => ({ trackNumber: numbers.get(r.key) ?? r.trackNumber }));
  };

  const addTags = () => {
    if (tagPick.length === 0) return;
    patchMany(new Set(selected), (r) => ({ tags: Array.from(new Set([...r.tags, ...tagPick])) }));
  };

  const removeTags = () => {
    if (tagPick.length === 0) return;
    patchMany(new Set(selected), (r) => ({ tags: r.tags.filter((t) => !tagPick.includes(t)) }));
  };

  const createAlbum = async () => {
    const title = newAlbumTitle.trim();
    if (!title) return;
    setCreatingAlbum(true);
    try {
      const { id } = await studioApi.createAlbum({ title });
      const list = await studioApi.albums();
      setAlbums(list.albums);
      setAlbumChoice(id);
      setNewAlbumTitle("");
      setNotice(`Created the album "${title}" - choose Apply to assign it.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create that album");
    } finally {
      setCreatingAlbum(false);
    }
  };

  // -------------------------------------------------------------- upload
  const uploadOne = useCallback(
    async (key: string, target: { key: string; content_type: string; upload_url: string }) => {
      const get = () => rowsRef.current.find((r) => r.key === key)!;
      const row = get();
      patchRow(key, { upload: "uploading", progress: 0, error: undefined }, false);
      try {
        const hash = row.hash ?? (await sha256Hex(row.file));
        const duration = await readDuration(row.file);
        await uploadWithProgress(target.upload_url, row.file, target.content_type, (p) =>
          patchRow(key, { progress: p }, false)
        );
        const now = get();
        const res = await studioApi.bulkComplete({
          file_key: key,
          filename: now.filename,
          size_bytes: now.file.size,
          title: now.title,
          artist: now.artist,
          album_id: now.albumId || null,
          track_number: now.trackNumber ? Number(now.trackNumber) : null,
          tags: now.tags,
          audio_key: target.key,
          duration_seconds: duration,
          content_hash: hash,
          allow_duplicate: includeDupes,
        });
        patchRow(key, { upload: "done", progress: 100, trackId: res.track_id, hash }, false);
        setRun((r) => (r ? { ...r, done: r.done + 1 } : r));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        patchRow(key, { upload: "error", error: message }, false);
        setRun((r) => (r ? { ...r, failed: r.failed + 1 } : r));
      }
    },
    [includeDupes, patchRow]
  );

  const startUpload = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      cancelRun.current = false;
      setRun({ active: true, total: keys.length, done: 0, failed: 0 });
      // Make sure what was typed is on the server before files start landing.
      await flush();
      for (let i = 0; i < keys.length && !cancelRun.current; i += UPLOAD_WAVE) {
        const wave = keys.slice(i, i + UPLOAD_WAVE);
        for (const k of wave) patchRow(k, { upload: "queued", error: undefined }, false);
        let uploads: { key: string; content_type: string; upload_url: string }[];
        try {
          const files = wave.map((k) => {
            const r = rowsRef.current.find((x) => x.key === k)!;
            return { filename: r.filename, content_type: r.file.type };
          });
          ({ uploads } = await studioApi.bulkPresign(files));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not start the upload";
          for (const k of wave) patchRow(k, { upload: "error", error: message }, false);
          setRun((r) => (r ? { ...r, failed: r.failed + wave.length } : r));
          continue;
        }
        await runPool(wave, UPLOAD_LANES, async (k, idx) => {
          if (cancelRun.current) {
            patchRow(k, { upload: "idle" }, false);
            return;
          }
          await uploadOne(k, uploads[idx]);
        });
      }
      setRun((r) => (r ? { ...r, active: false } : r));
      studioApi.bulkSummary().then(setSummary).catch(() => {});
    },
    [flush, patchRow, uploadOne]
  );

  const retryRow = useCallback(
    (key: string) => {
      void startUpload([key]);
    },
    [startUpload]
  );

  // -------------------------------------------------------------- render
  const hintFor = (tag: string) => channelHints.get(tag)?.join(", ");
  const selectedCount = selected.size;
  const untitledCount = rows.filter((r) => !r.title.trim() && r.upload !== "done").length;

  return (
    <div className="bi-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Bulk Import</h1>
        <Link to="/studio/drafts" className="btn">
          Drafts{summary ? ` (${summary.drafts})` : ""}
        </Link>
      </div>
      <p style={{ color: "var(--text-dim)" }}>
        For a whole folder of music. Titles are never guessed for you - you listen and type each one (or, if your file
        names are the titles, copy them in with one click) - so the page is built to make that quick: press <strong>▶</strong> to hear a row, type its title and press <strong>Enter</strong>{" "}
        to jump to the next row and play it. Everything you type is saved as you go and comes back when you choose the
        same folder again. Uploaded tracks become <strong>drafts</strong> you can keep editing until you publish them.
      </p>

      {/* 1 - choose */}
      <div className="card bi-card">
        <h3 style={{ marginTop: 0 }}>1. Choose your music</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="btn primary" style={{ cursor: "pointer" }}>
            Choose a folder
            <input
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
          </label>
          <label className="btn" style={{ cursor: "pointer" }}>
            Choose files
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {rows.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              {counts.total} files · {counts.titled} titled · {counts.uploaded} uploaded
              {counts.dupes > 0 ? ` · ${counts.dupes} possible duplicates` : ""}
            </span>
          )}
        </div>
        {summary && (summary.typed_not_uploaded > 0 || summary.uploaded > 0) && (
          <p style={{ color: "var(--text-dim)", margin: "10px 0 0", fontSize: "0.85rem" }}>
            Saved from earlier sittings: {summary.typed_not_uploaded} titled but not uploaded, {summary.uploaded} uploaded.
            Choose the same folder again to carry on where you left off.
          </p>
        )}
        {notice && <p style={{ margin: "10px 0 0", fontSize: "0.85rem" }}>{notice}</p>}
        {hashStatus && <p style={{ color: "var(--text-dim)", margin: "6px 0 0", fontSize: "0.8rem" }}>{hashStatus}</p>}
      </div>

      {/* 2 - constants and bulk actions */}
      <div className="card bi-card">
        <h3 style={{ marginTop: 0 }}>2. Set the things that are the same</h3>

        <div className="bi-action">
          <label>Artist</label>
          <input
            value={settings.artist}
            placeholder="e.g. the name to show for every track"
            onChange={(e) => setSettings((s) => ({ ...s, artist: e.target.value }))}
          />
          <button className="btn" onClick={() => applyArtist("all")} disabled={!settings.artist.trim() || rows.length === 0}>
            Apply to all
          </button>
          <button className="btn" onClick={() => applyArtist("selected")} disabled={!settings.artist.trim() || selectedCount === 0}>
            Apply to selected
          </button>
          <label className="bi-inline">
            <input type="checkbox" checked={onlyBlank} onChange={(e) => setOnlyBlank(e.target.checked)} /> only where blank
          </label>
        </div>

        <div className="bi-action">
          <label>Album</label>
          <select value={albumChoice} onChange={(e) => setAlbumChoice(e.target.value)}>
            <option value="">Choose an album...</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => applyAlbum("all")} disabled={!albumChoice || rows.length === 0}>
            Apply to all
          </button>
          <button className="btn" onClick={() => applyAlbum("selected")} disabled={!albumChoice || selectedCount === 0}>
            Apply to selected
          </button>
        </div>
        <div className="bi-action">
          <label>New album</label>
          <input
            value={newAlbumTitle}
            placeholder="Create an album without leaving this page"
            onChange={(e) => setNewAlbumTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createAlbum();
            }}
          />
          <button className="btn" onClick={createAlbum} disabled={!newAlbumTitle.trim() || creatingAlbum}>
            {creatingAlbum ? "Creating..." : "Create"}
          </button>
        </div>

        <div className="bi-action">
          <label>Track numbers</label>
          <span style={{ color: "var(--text-dim)" }}>number the selected rows, in grid order, starting at</span>
          <input
            type="number"
            min={1}
            value={numberStart}
            style={{ width: 80 }}
            onChange={(e) => setNumberStart(Math.max(1, Number(e.target.value) || 1))}
          />
          <button className="btn" onClick={numberSelected} disabled={selectedCount === 0}>
            Number selected
          </button>
        </div>

        <div className="bi-action" style={{ alignItems: "flex-start" }}>
          <label>Mood tags</label>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[...MOOD_OPTIONS, ...tagPick.filter((t) => !MOOD_OPTIONS.includes(t))].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`chip${tagPick.includes(tag) ? " selected" : ""}`}
                  title={hintFor(tag) ? `Feeds: ${hintFor(tag)}` : undefined}
                  onClick={() => setTagPick((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]))}
                >
                  {tag}
                  {hintFor(tag) ? ` → ${hintFor(tag)}` : ""}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
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
              <button className="btn" onClick={addTags} disabled={tagPick.length === 0 || selectedCount === 0}>
                Add to selected
              </button>
              <button className="btn" onClick={removeTags} disabled={tagPick.length === 0 || selectedCount === 0}>
                Remove from selected
              </button>
            </div>
            <small style={{ color: "var(--text-dim)" }}>
              Tags decide which channels a track can play on (shown after the arrow). Group tracks by album or ear, select
              them, then tag the whole group.
            </small>
          </div>
        </div>

        <div className="bi-action">
          <label>Listening</label>
          <label className="bi-inline">
            <input
              type="checkbox"
              checked={settings.autoplay}
              onChange={(e) => setSettings((s) => ({ ...s, autoplay: e.target.checked }))}
            />{" "}
            play the next row when I press Enter
          </label>
          <label className="bi-inline">
            start at{" "}
            <select value={settings.playFrom} onChange={(e) => setSettings((s) => ({ ...s, playFrom: e.target.value as Settings["playFrom"] }))}>
              <option value="start">the beginning</option>
              <option value="quarter">a quarter of the way in</option>
              <option value="middle">the middle</option>
            </select>
          </label>
          <label className="bi-inline">
            <input
              type="checkbox"
              checked={settings.snippet}
              onChange={(e) => setSettings((s) => ({ ...s, snippet: e.target.checked }))}
            />{" "}
            just {SNIPPET_SECONDS} seconds
          </label>
          <button className="btn" onClick={stopPlayback} disabled={!playingKey}>
            Stop
          </button>
        </div>

        <div className="bi-action">
          <label>File names</label>
          <span style={{ color: "var(--text-dim)" }}>if your file names are the song titles:</span>
          <button className="btn" onClick={useFileNames} disabled={rows.length === 0}>
            Use file names as titles{selectedCount > 0 ? " (selected rows)" : ""}
          </button>
          <label className="bi-inline">
            <input
              type="checkbox"
              checked={settings.tidyCaps}
              onChange={(e) => setSettings((s) => ({ ...s, tidyCaps: e.target.checked }))}
            />{" "}
            tidy ALL CAPS names
          </label>
        </div>

        <div className="bi-action" style={{ alignItems: "flex-start" }}>
          <label>Paste titles</label>
          {!showPaste ? (
            <button className="btn" onClick={() => setShowPaste(true)} disabled={rows.length === 0}>
              Paste a list of titles...
            </button>
          ) : (
            <div style={{ flex: 1, minWidth: 260 }}>
              <textarea
                rows={5}
                value={pasteText}
                placeholder={"One title per line (from a tracklist, a document...)\nOptional: title, then a Tab, then the artist"}
                style={{ width: "100%" }}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <button
                  className="btn primary"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    const keys = visibleRows.map((r) => r.key);
                    const start = keys.find((k) => selected.has(k)) ?? keys[0];
                    if (start) applyLines(start, pasteText);
                    setPasteText("");
                    setShowPaste(false);
                  }}
                >
                  Fill from {selectedCount > 0 ? "the first selected row" : "the top"}
                </button>
                <button
                  className="btn"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    const first = visibleRows.find((r) => !r.title.trim());
                    if (first) applyLines(first.key, pasteText, true);
                    setPasteText("");
                    setShowPaste(false);
                  }}
                >
                  Fill only the untitled rows
                </button>
                <button className="btn" onClick={() => setShowPaste(false)}>
                  Cancel
                </button>
              </div>
              <small style={{ color: "var(--text-dim)" }}>
                Titles go into the grid one per row, in grid order. You can also paste a column straight into any Title box.
              </small>
            </div>
          )}
        </div>
      </div>

      {/* 3 - the grid */}
      <div className="card bi-card" style={{ padding: 0 }}>
        <div className="bi-gridbar">
          <strong>3. Listen, type, Enter</strong>
          <span style={{ color: "var(--text-dim)" }}>
            {selectedCount} selected · {untitledCount} untitled
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => selectWhere(() => true)} disabled={visibleRows.length === 0}>
            Select all
          </button>
          <button className="btn" onClick={() => selectWhere((r) => !r.title.trim())} disabled={visibleRows.length === 0}>
            Select untitled
          </button>
          <button className="btn" onClick={() => setSelected(new Set())} disabled={selectedCount === 0}>
            Clear
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
            <option value="all">Show: all rows</option>
            <option value="needs-title">Show: needs a title</option>
            <option value="not-uploaded">Show: not uploaded</option>
            <option value="uploaded">Show: uploaded drafts</option>
            <option value="duplicates">Show: possible duplicates</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <p style={{ color: "var(--text-dim)", padding: "0 16px 16px" }}>
            Nothing here yet - choose a folder or some files above.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="bi-grid">
              <colgroup>
                <col style={{ width: 34 }} />
                <col style={{ width: 42 }} />
                <col style={{ width: 52 }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: 64 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th>#</th>
                  <th></th>
                  <th>File</th>
                  <th>Title</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>Track</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <RowView
                    key={row.key}
                    row={row}
                    index={indexByKey.get(row.key) ?? 0}
                    selected={selected.has(row.key)}
                    playing={playingKey === row.key}
                    albums={albums}
                    dupNote={dupNotes.get(row.key)}
                    registerTitle={registerTitle}
                    onSelect={onSelect}
                    onPlay={playRow}
                    onEdit={patchRow}
                    onEnter={onEnter}
                    onPasteTitles={onPasteTitles}
                    onRetry={retryRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        style={{ display: "none" }}
        onTimeUpdate={(e) => {
          if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) stopPlayback();
        }}
        onEnded={stopPlayback}
      />

      {/* 4 - upload (stays in view) */}
      <div className="card bi-upload">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <strong>4. Upload as drafts</strong>
          <span className={`bi-save bi-save-${saveState}`}>
            {saveState === "saved" && "All changes saved"}
            {saveState === "pending" && "Changes not saved yet..."}
            {saveState === "saving" && "Saving..."}
            {saveState === "error" && "Couldn't save - retrying"}
          </span>
          <span style={{ flex: 1 }} />
          <label className="bi-inline" title="Upload files even if they look like duplicates">
            <input type="checkbox" checked={includeDupes} onChange={(e) => setIncludeDupes(e.target.checked)} /> include possible duplicates
          </label>
          {run?.active ? (
            <button
              className="btn"
              onClick={() => {
                cancelRun.current = true;
              }}
            >
              Stop after the current files
            </button>
          ) : (
            <>
              <button
                className="btn"
                disabled={selectedReady.length === 0}
                onClick={() => startUpload(selectedReady.map((r) => r.key))}
              >
                Upload selected ({selectedReady.length})
              </button>
              <button
                className="btn"
                disabled={readyRows.length === 0}
                onClick={() => startUpload(readyRows.slice(0, 50).map((r) => r.key))}
              >
                Upload next {Math.min(50, readyRows.length)}
              </button>
              <button
                className="btn primary"
                disabled={readyRows.length === 0}
                onClick={() => startUpload(readyRows.map((r) => r.key))}
              >
                Upload all ready ({readyRows.length})
              </button>
            </>
          )}
        </div>
        {rows.length > 0 && readyRows.length === 0 && !run?.active && (
          <p style={{ margin: "8px 0 0", fontSize: "0.85rem", color: "#f0a12a" }}>
            Nothing is ready to upload yet:{" "}
            {untitledCount > 0
              ? `${untitledCount} row${untitledCount === 1 ? " needs" : "s need"} a title (type them, paste them, or use the file names). `
              : ""}
            {counts.dupes > 0
              ? `${counts.dupes} look like duplicates (tick "include possible duplicates" to upload them anyway). `
              : ""}
            {untitledCount > 0 && (
              <button className="btn" onClick={useFileNames}>
                Use file names as titles
              </button>
            )}
          </p>
        )}
        {run && (
          <div style={{ marginTop: 8 }}>
            <div className="bi-progress bi-progress-wide">
              <span style={{ width: `${run.total ? Math.round(((run.done + run.failed) / run.total) * 100) : 0}%` }} />
            </div>
            <small style={{ color: "var(--text-dim)" }}>
              {run.active ? "Uploading" : "Finished"}: {run.done} of {run.total} done
              {run.failed > 0 ? `, ${run.failed} failed (use Retry on those rows)` : ""}.
              {run.active ? " You can carry on typing while this runs - just keep this tab open." : ""}
              {!run.active && run.done > 0 && (
                <>
                  {" "}
                  <Link to="/studio/drafts">Open Drafts to review and publish</Link>.
                </>
              )}
            </small>
          </div>
        )}
        <small style={{ color: "var(--text-dim)", display: "block", marginTop: 6 }}>
          Files upload {UPLOAD_LANES} at a time. Only rows with a title are uploaded, and nothing goes live - every track
          arrives as a draft. Uploads can be split into chunks and stopped any time; files already uploaded stay uploaded.
          {readyRows.length > 0 &&
            ` ${readyRows.length} ready (${humanSize(readyRows.reduce((n, r) => n + r.file.size, 0))}).`}
        </small>
      </div>
    </div>
  );
}
