import { useEffect, useMemo, useRef, useState } from "react";
import { unzip } from "fflate";
import { studioApi, uploadFileToR2, type SongIntro } from "../../api/client";

/**
 * Import intros (handoff_import_intros.md §5): the zip the Intro Maker app
 * makes (MP3s named after the songs, plus manifest.json / manifest.csv), or
 * the MP3s and the manifest chosen directly. Each MP3 is matched to a song -
 * by the manifest's station track ID, then by exact title (ignoring case and
 * the characters the app replaces in file names), then by title within the
 * manifest's album - and shown in a review list where any match can be fixed.
 * Import uploads the chosen ones and attaches them, played before the song.
 */

interface ManifestEntry {
  file_name: string;
  song_title?: string;
  album?: string;
  city?: string;
  country?: string;
  station_track_id?: string;
  audio_seconds?: number | string;
  script?: string;
}

type MatchState = "id" | "title" | "album" | "loose" | "several" | "none";

interface Row {
  key: string;
  fileName: string;
  blob: Blob;
  url: string;
  seconds: number | null;
  script: string | null;
  candidates: string[];
  state: MatchState;
  trackId: string;
  include: boolean;
  replace: boolean;
}

// Up to this many at once go to the Worker (routes/intros.ts IMPORT_BATCH).
const IMPORT_BATCH = 16;

/** A title as the Intro Maker app writes file names: case, spacing and the characters Windows won't take don't count. */
export const titleKey = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");

/**
 * Looser still, for file names that lost a character on the way: punctuation
 * and symbols don't count at all ("Je taime Paris" for "Je t'aime Paris", or a
 * dash a zip tool turned into "?"). Only used when exactly one song matches.
 */
export const looseKey = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents: "é" counts as "e"
    .toLowerCase()
    .replace(/['’‘`´]/g, "") // apostrophes vanish: "t'aime" is "taime"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const stemOf = (name: string) => name.replace(/\.mp3$/i, "");

/** CSV with quoted fields (the Intro Maker writes scripts with commas and line breaks). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  const names = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ""])));
}

function manifestFrom(text: string, json: boolean): ManifestEntry[] {
  if (json) {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return items.filter((x: any) => x?.file_name);
  }
  return parseCsv(text).filter((r) => r.file_name) as unknown as ManifestEntry[];
}

function unzipAsync(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => unzip(bytes, (err, files) => (err ? reject(err) : resolve(files))));
}

function audioSeconds(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = url;
  });
}

export function ImportIntros({
  tracks,
  intros,
  onClose,
  onImported,
}: {
  tracks: any[];
  intros: Map<string, SongIntro>;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    },
    []
  );

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const optionLabel = (t: any) => `${t.title}${t.album_title ? ` — ${t.album_title}` : ""}${t.status !== "published" ? ` (${t.status})` : ""}`;
  const byOption = useMemo(() => new Map(tracks.map((t) => [optionLabel(t), t.id])), [tracks]);

  const match = (stem: string, m: ManifestEntry | undefined): Pick<Row, "candidates" | "state" | "trackId"> => {
    if (m?.station_track_id && byId.has(m.station_track_id)) return { candidates: [m.station_track_id], state: "id", trackId: m.station_track_id };
    const tryTitle = (title: string, album: string | null) => {
      const same = tracks.filter((t) => titleKey(t.title) === titleKey(title));
      if (same.length === 1) return { candidates: [same[0].id], state: "title" as const, trackId: same[0].id };
      if (same.length > 1) {
        const inAlbum = album ? same.filter((t) => titleKey(t.album_title) === titleKey(album)) : [];
        if (inAlbum.length === 1) return { candidates: same.map((t) => t.id), state: "album" as const, trackId: inAlbum[0].id };
        return { candidates: same.map((t) => t.id), state: "several" as const, trackId: "" };
      }
      return null;
    };
    const found = tryTitle(m?.song_title || stem, m?.album || null);
    if (found) return found;
    // No manifest: "Title (Album).mp3" or "Title (2).mp3", as the app names clashing titles.
    const paren = /^(.*) \(([^)]+)\)$/.exec(stem);
    if (!m && paren) {
      const again = tryTitle(paren[1], /^\d+$/.test(paren[2]) ? null : paren[2]);
      if (again) return again;
    }
    // Last: punctuation ignored, and only if that leaves exactly one song (the row says so, to be checked).
    for (const title of [m?.song_title || stem, ...(paren && !m ? [paren[1]] : [])]) {
      const loose = tracks.filter((t) => looseKey(t.title) === looseKey(title));
      if (loose.length === 1) return { candidates: [loose[0].id], state: "loose", trackId: loose[0].id };
    }
    return { candidates: [], state: "none", trackId: "" };
  };

  const readFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setReading(true);
    setError(null);
    try {
      const mp3s: { name: string; blob: Blob }[] = [];
      let manifest: ManifestEntry[] = [];
      let manifestIsJson = false;
      const take = async (name: string, data: Blob | Uint8Array) => {
        const file = baseName(name);
        if (name.includes("__MACOSX") || file.startsWith(".")) return;
        const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
        if (/\.mp3$/i.test(file)) mp3s.push({ name: file, blob: new Blob([blob], { type: "audio/mpeg" }) });
        else if (/^manifest\.json$/i.test(file)) {
          manifest = manifestFrom(await blob.text(), true);
          manifestIsJson = true;
        } else if (/^manifest\.csv$/i.test(file) && !manifestIsJson) manifest = manifestFrom(await blob.text(), false);
      };
      for (const f of Array.from(files)) {
        if (/\.zip$/i.test(f.name)) {
          const entries = await unzipAsync(new Uint8Array(await f.arrayBuffer()));
          for (const [name, bytes] of Object.entries(entries)) if (!name.endsWith("/")) await take(name, bytes);
        } else await take(f.name, f);
      }
      if (mp3s.length === 0) throw new Error("No MP3 files found. Choose the zip from Intro Maker, or the MP3s and manifest.csv.");

      const byFile = new Map(manifest.map((m) => [m.file_name.toLowerCase(), m]));
      const built: Row[] = await Promise.all(
        mp3s
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (f, i) => {
            const m = byFile.get(f.name.toLowerCase());
            const url = URL.createObjectURL(f.blob);
            urls.current.push(url);
            const listed = Number(m?.audio_seconds);
            const seconds = Number.isFinite(listed) && listed > 0 ? listed : await audioSeconds(url);
            const found = match(stemOf(f.name), m);
            return {
              key: `${i}:${f.name}`,
              fileName: f.name,
              blob: f.blob,
              url,
              seconds,
              script: m?.script?.trim() || null,
              ...found,
              include: !!found.trackId,
              replace: false,
            };
          })
      );
      setRows(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read those files.");
    } finally {
      setReading(false);
    }
  };

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // The same song picked for two files: neither can go until one is changed.
  const clashes = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) if (r.include && r.trackId) count.set(r.trackId, (count.get(r.trackId) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const chosen = rows.filter((r) => r.include && r.trackId && !clashes.has(r.trackId));
  const toSend = chosen.filter((r) => !intros.has(r.trackId) || r.replace);
  const tooLong = toSend.filter((r) => !r.seconds || r.seconds > 120);

  const togglePlay = (r: Row) => {
    const a = player.current;
    if (!a) return;
    if (playing === r.key) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = r.url;
    void a.play();
    setPlaying(r.key);
  };

  const runImport = async () => {
    setError(null);
    const done: { track_id: string; audio_url: string; duration_seconds: number; script: string | null; replace: boolean }[] = [];
    try {
      for (let i = 0; i < toSend.length; i++) {
        const r = toSend[i];
        const t = byId.get(r.trackId);
        setBusy(`Uploading ${i + 1} of ${toSend.length}: ${t?.title ?? r.fileName}…`);
        const { upload_url, key } = await studioApi.presignUpload(`intro-${r.fileName}`, "audio/mpeg", "audio");
        await uploadFileToR2(upload_url, new File([r.blob], r.fileName, { type: "audio/mpeg" }));
        done.push({ track_id: r.trackId, audio_url: key, duration_seconds: Math.round(r.seconds ?? 0), script: r.script, replace: r.replace });
      }
      let imported = 0;
      let replaced = 0;
      for (let i = 0; i < done.length; i += IMPORT_BATCH) {
        setBusy(`Attaching ${Math.min(i + IMPORT_BATCH, done.length)} of ${done.length}…`);
        const res = await studioApi.importIntros(done.slice(i, i + IMPORT_BATCH));
        imported += res.imported;
        replaced += res.replaced;
      }
      const kept = chosen.length - toSend.length;
      onImported(
        `Imported ${imported} intro${imported === 1 ? "" : "s"}${replaced ? `, replaced ${replaced}` : ""}${kept ? `, kept ${kept} existing` : ""}. They play before their songs from the next log rebuild (about a minute).`
      );
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "The import stopped."} ${done.length ? `${done.length} file${done.length === 1 ? " was" : "s were"} uploaded but not all were attached - run the import again; songs that got their intro will show it.` : ""}`
      );
    } finally {
      setBusy(null);
    }
  };

  const stateText = (r: Row): string => {
    if (r.trackId && clashes.has(r.trackId)) return "Same song as another file: pick one";
    if (r.state === "id") return "Matched by track ID";
    if (r.state === "title") return "Matched by title";
    if (r.state === "album") return "Matched by title and album";
    if (r.state === "loose") return "Matched by title, ignoring punctuation: check it";
    if (r.state === "several") return r.trackId ? "Picked by hand" : "Several songs match: pick one";
    return r.trackId ? "Picked by hand" : "No match";
  };

  const matched = rows.filter((r) => r.trackId).length;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Import intros</h2>
        <button className="btn" onClick={onClose} disabled={!!busy}>
          Close
        </button>
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>
        Choose the zip from Intro Maker, or select its MP3s together with manifest.csv. Each file is matched to a song by its track ID, then by
        title. Check the list, fix anything that's wrong, then press Import. Intros play before their song; you can change that per song below.
      </p>
      <input type="file" accept=".zip,.mp3,.csv,.json,audio/mpeg,application/zip" multiple disabled={reading || !!busy} onChange={(e) => readFiles(e.target.files)} />
      {reading && <p>Reading the files…</p>}
      {error && <p style={{ color: "#e5484d" }}>{error}</p>}
      <audio ref={player} onEnded={() => setPlaying(null)} />
      <datalist id="intro-song-options">
        {tracks.map((t) => (
          <option key={t.id} value={optionLabel(t)} />
        ))}
      </datalist>

      {rows.length > 0 && (
        <>
          <p style={{ fontSize: "0.9rem" }}>
            {rows.length} file{rows.length === 1 ? "" : "s"}, {matched} matched to a song.
          </p>
          <table>
            <thead>
              <tr>
                <th>Import</th>
                <th>File</th>
                <th>Song</th>
                <th>Length</th>
                <th>Song already has an intro</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = r.trackId ? byId.get(r.trackId) : null;
                const has = r.trackId ? intros.get(r.trackId) : undefined;
                const problem = !r.trackId || clashes.has(r.trackId) || r.state === "loose";
                return (
                  <tr key={r.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Import ${r.fileName}`}
                        checked={r.include}
                        disabled={!r.trackId}
                        onChange={(e) => update(r.key, { include: e.target.checked })}
                      />
                    </td>
                    <td style={{ fontSize: "0.85rem" }}>{r.fileName}</td>
                    <td>
                      {r.state === "several" && (
                        <select
                          value={r.trackId}
                          aria-label={`Song for ${r.fileName}`}
                          onChange={(e) => update(r.key, { trackId: e.target.value, include: !!e.target.value })}
                          style={{ marginBottom: 4, display: "block" }}
                        >
                          <option value="">Pick one of {r.candidates.length}…</option>
                          {r.candidates.map((id) => (
                            <option key={id} value={id}>
                              {optionLabel(byId.get(id))}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        list="intro-song-options"
                        aria-label={`Song for ${r.fileName}`}
                        placeholder="Type to find the song…"
                        defaultValue={t ? optionLabel(t) : ""}
                        key={r.trackId || "none"}
                        onChange={(e) => {
                          const id = byOption.get(e.target.value);
                          if (id) update(r.key, { trackId: id, include: true, state: r.state === "several" ? "several" : "none" });
                          else if (!e.target.value) update(r.key, { trackId: "", include: false });
                        }}
                        style={{ minWidth: 260 }}
                      />
                      <div style={{ fontSize: "0.8rem", color: problem ? "#f0a12a" : "var(--text-dim)" }}>{stateText(r)}</div>
                    </td>
                    <td style={{ color: r.seconds && r.seconds > 25 ? "#f0a12a" : undefined }}>{r.seconds ? `${r.seconds.toFixed(1)} s` : "?"}</td>
                    <td>
                      {has ? (
                        <select value={r.replace ? "replace" : "keep"} onChange={(e) => update(r.key, { replace: e.target.value === "replace" })}>
                          <option value="keep">Keep the old one</option>
                          <option value="replace">Replace it</option>
                        </select>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>No</span>
                      )}
                    </td>
                    <td>
                      <button className="btn" onClick={() => togglePlay(r)}>
                        {playing === r.key ? "Stop" : "Play"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tooLong.length > 0 && (
            <p style={{ color: "#e5484d" }}>
              {tooLong.length} intro{tooLong.length === 1 ? " has" : "s have"} no readable length or run over 2 minutes; untick {tooLong.length === 1 ? "it" : "them"} to import the rest.
            </p>
          )}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button className="btn primary" onClick={runImport} disabled={!!busy || toSend.length === 0 || tooLong.length > 0}>
              {busy ? "Importing…" : `Import ${toSend.length} intro${toSend.length === 1 ? "" : "s"}`}
            </button>
            {busy && <span style={{ fontSize: "0.9rem" }}>{busy}</span>}
            {!busy && chosen.length > toSend.length && (
              <span style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                {chosen.length - toSend.length} song{chosen.length - toSend.length === 1 ? " keeps its" : "s keep their"} existing intro.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
