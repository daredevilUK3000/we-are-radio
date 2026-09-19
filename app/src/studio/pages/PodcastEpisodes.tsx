import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";

type Episode = {
  id: string;
  title: string;
  show_name: string | null;
  episode_number: number | null;
  status: string;
  publish_date: string | null;
  duration_seconds: number | null;
  channel_name: string | null;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function PodcastEpisodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const r = await studioApi.podcastEpisodes();
    setEpisodes(r.episodes);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const shows = useMemo(
    () => Array.from(new Set(episodes.map((e) => e.show_name ?? "(no show name)"))).sort(),
    [episodes]
  );

  const visible = episodes.filter(
    (e) =>
      (show === "all" || (e.show_name ?? "(no show name)") === show) && (status === "all" || e.status === status)
  );

  const visibleIds = visible.map((e) => e.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedIds = episodes.filter((e) => selected.has(e.id)).map((e) => e.id);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setSelected(new Set());
      await load();
      setMessage(label);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const setStatusFor = (ids: string[], next: "published" | "draft") =>
    run(`${ids.length} episode${ids.length === 1 ? "" : "s"} ${next === "published" ? "published" : "moved to draft (hidden from listeners)"}.`, () =>
      studioApi.setPodcastEpisodesStatus(ids, next)
    );

  const deleteEpisodes = (ids: string[]) => {
    const what = ids.length === 1 ? "this episode" : `these ${ids.length} episodes`;
    if (!window.confirm(`Delete ${what}? This can't be undone (you could re-import from the feed later).`)) return;
    return run(`${ids.length} episode${ids.length === 1 ? "" : "s"} deleted.`, () =>
      studioApi.deletePodcastEpisodes(ids)
    );
  };

  const published = episodes.filter((e) => e.status === "published").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Podcasts</h1>
        <Link to="/studio/podcast-import" className="btn primary" style={{ marginLeft: "auto" }}>
          Import episodes
        </Link>
      </div>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        {loading
          ? "Loading..."
          : `${episodes.length} imported episodes · ${published} live for listeners · ${episodes.length - published} draft`}
        . Only published episodes appear on the site.
      </p>

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Show</label>
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">All shows</option>
            {shows.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>{selectedIds.length} selected</span>
          <button className="btn primary" disabled={busy || selectedIds.length === 0} onClick={() => setStatusFor(selectedIds, "published")}>
            Publish
          </button>
          <button className="btn" disabled={busy || selectedIds.length === 0} onClick={() => setStatusFor(selectedIds, "draft")}>
            Unpublish
          </button>
          <button className="btn" disabled={busy || selectedIds.length === 0} onClick={() => deleteEpisodes(selectedIds)}>
            Delete
          </button>
        </div>
      </div>

      {message && <p style={{ color: "var(--text-dim)" }}>{message}</p>}

      {!loading && episodes.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>
          No podcast episodes yet - use <Link to="/studio/podcast-import">Import episodes</Link> to pull some in from a
          podcast feed.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all shown" />
              </th>
              <th>Episode</th>
              <th>Show</th>
              <th>Released</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id}>
                <td>
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.title}`} />
                </td>
                <td>
                  {e.title}
                  {e.duration_seconds ? (
                    <span style={{ color: "var(--text-muted)" }}> · {Math.round(e.duration_seconds / 60)} min</span>
                  ) : null}
                </td>
                <td>{e.show_name ?? <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(e.publish_date)}</td>
                <td>
                  <span className={`badge${e.status === "published" ? " live" : ""}`}>{e.status}</span>
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => setStatusFor([e.id], e.status === "published" ? "draft" : "published")}
                  >
                    {e.status === "published" ? "Unpublish" : "Publish"}
                  </button>{" "}
                  <button className="btn" disabled={busy} onClick={() => deleteEpisodes([e.id])}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
