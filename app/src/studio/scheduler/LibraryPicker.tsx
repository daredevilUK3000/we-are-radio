import { useEffect, useRef, useState } from "react";
import { clock, Modal, whenAgo } from "./common";
import { friendly, schedApi, type LibraryResult } from "./api";

const TYPES = [
  { key: "songs", label: "Songs" },
  { key: "ids", label: "Station IDs & jingles" },
  { key: "promos", label: "Promos" },
  { key: "links", label: "Links" },
  { key: "capsules", label: "Capsules" },
  { key: "features", label: "Features & interviews" },
] as const;

/** Drag-and-drop payload type for library items (the Timeline's drawer and the running-order editor). */
export const LIBRARY_MIME = "application/x-wr-library";

/**
 * Search the library for something to put on air. Keyboard: type to search,
 * Tab to the results, Enter to choose.
 */
export function LibraryPicker({
  channelSlug,
  title,
  actionLabel,
  initialType = "songs",
  onPick,
  onClose,
}: {
  channelSlug: string;
  title: string;
  actionLabel: string;
  initialType?: (typeof TYPES)[number]["key"];
  onPick: (item: LibraryResult) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>(initialType);
  const [results, setResults] = useState<LibraryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = Date.now();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      schedApi
        .library(q, type, channelSlug)
        .then((r) => !cancelled && (setResults(r.results), setError(null)))
        .catch((err) => !cancelled && setError(friendly(err)));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [q, type, channelSlug]);

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="sch-picker">
        <label className="sch-field">
          <span className="sch-label">Search</span>
          <input
            ref={searchRef}
            className="sch-input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, artist or album"
            aria-controls="sch-picker-results"
          />
        </label>
        <div className="sch-chips" role="group" aria-label="Show">
          {TYPES.map((t) => (
            <button key={t.key} type="button" className={`sch-chip${type === t.key ? " is-on" : ""}`} aria-pressed={type === t.key} onClick={() => setType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {error && (
          <p className="sch-error" role="alert">
            {error}
          </p>
        )}
        <ul id="sch-picker-results" className="sch-picker-list" aria-label="Results" aria-busy={results === null}>
          {results?.length === 0 && <li className="sch-dim sch-picker-empty">Nothing matches.</li>}
          {results?.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <button type="button" className="sch-picker-row" onClick={() => onPick(r)}>
                <span className="sch-picker-main">
                  <span className="sch-picker-title">{r.title}</span>
                  <span className="sch-dim">
                    {[r.artist, r.album].filter(Boolean).join(" · ") || kindLabel(r.kind)}
                  </span>
                </span>
                <span className="sch-picker-len">{clock(r.duration_seconds * 1000)}</span>
                <span className="sch-picker-last sch-dim">{whenAgo(r.last_aired_ms, now)}</span>
                <span className="sch-picker-go">{actionLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

const kindLabel = (k: string) =>
  ({ song: "Song", station_id: "Station ID", jingle: "Jingle", promo: "Promo", link: "Link", feature: "Capsule / feature", interview: "Interview", programme: "Programme", playlist: "Playlist", template: "Template" })[k] ?? k;

/**
 * The library as an inline, draggable list (Release 2): search, then drag a
 * result onto a running order or a Timeline block, or press its button.
 */
export function LibrarySearch({
  channelSlug,
  types,
  actionLabel,
  onPick,
}: {
  channelSlug?: string;
  types: { key: string; label: string }[];
  actionLabel: string;
  onPick: (item: LibraryResult) => void;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState(types[0].key);
  const [results, setResults] = useState<LibraryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      schedApi
        .library(q, type, channelSlug)
        .then((r) => !cancelled && (setResults(r.results), setError(null)))
        .catch((err) => !cancelled && setError(friendly(err)));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [q, type, channelSlug]);
  return (
    <div className="sch-libsearch">
      <input className="sch-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" aria-label="Search the library" />
      <div className="sch-chips" role="group" aria-label="Show">
        {types.map((t) => (
          <button key={t.key} type="button" className={`sch-chip${type === t.key ? " is-on" : ""}`} aria-pressed={type === t.key} onClick={() => setType(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="sch-error">{error}</p>}
      <ul className="sch-libsearch-list" aria-busy={results === null}>
        {results?.length === 0 && <li className="sch-dim">Nothing matches.</li>}
        {results?.map((r) => (
          <li
            key={`${r.kind}:${r.id}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify({ ...r, kind: r.kind ?? type }));
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <span className="sch-libsearch-grip" aria-hidden="true">⠿</span>
            <span className="sch-libsearch-main">
              <span className="sch-picker-title">{r.title}</span>
              <span className="sch-dim">
                {[r.artist, kindLabel(r.kind ?? type)].filter(Boolean).join(" · ")}
                {r.duration_seconds ? ` · ${clock(r.duration_seconds * 1000)}` : ""}
              </span>
            </span>
            <button type="button" className="sch-btn sch-btn-sm" onClick={() => onPick({ ...r, kind: r.kind ?? type })} aria-label={`${actionLabel}: ${r.title}`}>
              {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
