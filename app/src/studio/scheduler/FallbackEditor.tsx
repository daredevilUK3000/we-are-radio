import { useEffect, useState } from "react";
import { friendly, schedApi } from "./api";
import { clock, Modal } from "./common";
import { LibraryPicker } from "./LibraryPicker";

interface Row {
  track_id: string | null;
  audio_asset_id: string | null;
  title: string;
  duration_seconds: number;
  status?: string;
}

/**
 * A channel's emergency playlist: what plays if the log ever runs out. An
 * ordered list - add from the library, remove, move up and down. Valid means
 * at least an hour long, everything published.
 */
export function FallbackEditor({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    schedApi.fallback(slug).then((r) => setRows(r.items as Row[])).catch((e) => setMessage(friendly(e)));
  }, [slug]);

  const total = (rows ?? []).reduce((s, r) => s + (r.duration_seconds || 0), 0);
  const unpublished = (rows ?? []).filter((r) => r.status && r.status !== "published" && r.status !== "ready").length;
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      if (!rs) return rs;
      const next = [...rs];
      const j = i + d;
      if (j < 0 || j >= next.length) return rs;
      [next[i], next[j]] = [next[j], next[i]];
      setDirty(true);
      return next;
    });

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      const r = await schedApi.saveFallback(slug, rows.map((x) => ({ track_id: x.track_id, audio_asset_id: x.audio_asset_id })));
      setMessage(r.valid ? "Saved. The emergency playlist is ready." : "Saved, but it isn't valid yet: it needs at least 60 minutes of published audio.");
      setDirty(false);
    } catch (err) {
      setMessage(friendly(err));
    } finally {
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <LibraryPicker
        channelSlug={slug}
        title="Add to the emergency playlist"
        actionLabel="Add"
        onClose={() => setPicking(false)}
        onPick={(r) => {
          setRows((rs) => [...(rs ?? []), { track_id: r.track_id ?? null, audio_asset_id: r.track_id ? null : r.audio_asset_id ?? null, title: r.title, duration_seconds: r.duration_seconds, status: "published" }]);
          setDirty(true);
          setPicking(false);
        }}
      />
    );
  }

  return (
    <Modal
      title={`${name}: emergency playlist`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="sch-btn" onClick={() => setPicking(true)}>
            Add from the library…
          </button>
          <button type="button" className="sch-btn sch-btn-red" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <p>If this channel's log ever runs out, it loops this list so listeners never hear silence.</p>
      <p className={total >= 3600 && !unpublished ? "sch-ok" : "sch-bad-text"}>
        {clock(total * 1000)} long{total < 3600 ? " · needs at least 60 minutes" : ""}
        {unpublished ? ` · ${unpublished} item(s) no longer published` : ""}
      </p>
      {message && <p role="status">{message}</p>}
      {!rows && <p className="sch-dim">Loading…</p>}
      <ol className="sch-fallback">
        {rows?.map((r, i) => (
          <li key={`${r.track_id ?? r.audio_asset_id}-${i}`}>
            <span className="sch-dim">{i + 1}</span>
            <span className="sch-fallback-title">
              {r.title}
              {r.status && r.status !== "published" && r.status !== "ready" && <span className="sch-tag is-red">Unpublished</span>}
            </span>
            <span className="sch-dim">{clock(r.duration_seconds * 1000)}</span>
            <button type="button" className="sch-icon-btn" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="sch-icon-btn" aria-label={`Move ${r.title} down`} disabled={i === (rows?.length ?? 0) - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button
              type="button"
              className="sch-icon-btn"
              aria-label={`Remove ${r.title}`}
              onClick={() => {
                setRows((rs) => rs?.filter((_, k) => k !== i) ?? rs);
                setDirty(true);
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
