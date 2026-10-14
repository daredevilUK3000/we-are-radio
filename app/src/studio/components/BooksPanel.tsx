import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, mediaUrl, studioApi } from "../../api/client";

/**
 * The Audio page's "Book of the Month" tab (handoff 14 Oct 2026, §4.1):
 * every month's book, newest first, with its status, next airing, airings so
 * far, on-demand listens and clicks. Its airings live in the Scheduler as
 * draft blocks until published; the form is pages/BookWizard.tsx.
 */

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const when = (s: number) =>
  new Date(s * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

const STATUS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Published",
  archived: "Archived",
};

export function BooksPanel() {
  const [books, setBooks] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<any | null>(null);

  const load = () =>
    studioApi
      .books()
      .then((r) => setBooks(r.books))
      .catch((e) => setError(e instanceof Error ? e.message : "The books couldn't be loaded"))
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save");
    }
    await load();
  };

  const remove = async (b: any, confirmed: boolean) => {
    setError(null);
    try {
      await studioApi.deleteBook(b.id, confirmed);
      setConfirming(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConfirming(b);
      else setError(e instanceof Error ? e.message : "That didn't delete");
    }
  };

  return (
    <div>
      <p style={{ color: "var(--text-dim)" }}>
        One of your books each month, with its 5-minute segment. Its airings go into the Scheduler as gold draft blocks: check them on the Timeline and
        publish as usual. Once published, the book shows on the landing page and at weareradio.app/books, and while it airs the players show its cover
        and a “Get the book” button (a QR code on the TV).
      </p>
      {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      {loaded && books.length === 0 && (
        <p>
          No books yet. <Link to="/studio/books/new">Set up the first Book of the Month</Link>.
        </p>
      )}

      {confirming && (
        <div className="card" role="alertdialog" aria-labelledby="botm-del-title" style={{ borderColor: "var(--accent)", marginBottom: 14 }}>
          <strong id="botm-del-title">{confirming.title} is published on {confirming.published_on.join(", ")}.</strong>
          <p style={{ margin: "8px 0" }}>
            Deleting it removes its blocks from the working copy. It keeps airing until you publish those channels again on the Timeline. Its page and short
            link stop working straight away.
          </p>
          <button className="btn primary" onClick={() => remove(confirming, true)}>
            Delete it anyway
          </button>{" "}
          <button className="btn" onClick={() => setConfirming(null)}>
            Keep it
          </button>
        </div>
      )}

      {books.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Book</th>
              <th>Status</th>
              <th>Next airing</th>
              <th>Airings so far</th>
              <th title="Listen now on the landing page and /books">Listens on demand</th>
              <th title="Get the book: players, Just played, TV scans, the landing page, /books and the short link">Clicks (7 days / all)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td style={{ whiteSpace: "nowrap" }}>{monthLabel(b.month)}</td>
                <td>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {b.cover_url ? (
                      <img src={mediaUrl(b.cover_url)} alt="" style={{ width: 36, height: 54, borderRadius: 4, objectFit: "cover", flex: "none" }} />
                    ) : (
                      <span style={{ width: 36, height: 54, borderRadius: 4, background: "rgba(217,181,108,0.25)", flex: "none" }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.title}</div>
                      <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
                        {b.author}
                        {b.segment_seconds ? ` · segment ${Math.floor(b.segment_seconds / 60)}:${String(Math.round(b.segment_seconds) % 60).padStart(2, "0")}` : " · no segment yet"}
                        {` · ${b.short_url.replace(/^https:\/\//, "")}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge">{STATUS[b.status] ?? b.status}</span>
                  {b.status === "draft" && b.draft_blocks > 0 && (
                    <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
                      {b.draft_blocks} draft block{b.draft_blocks === 1 ? "" : "s"}: publish on the Timeline
                    </div>
                  )}
                  {b.status === "scheduled" && <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>{b.published_on.join(", ")}</div>}
                </td>
                <td>{b.next_airing ? `${when(b.next_airing.starts_at)} on ${b.next_airing.channel_name}` : "-"}</td>
                <td>{b.airings}</td>
                <td>{b.listens}</td>
                <td>
                  {b.clicks_7d} / {b.clicks_all}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link className="btn" to={`/studio/books/new?id=${b.id}`}>
                    Edit
                  </Link>{" "}
                  <button className="btn" onClick={() => run(() => studioApi.setBookArchived(b.id, b.status !== "archived"))}>
                    {b.status === "archived" ? "Unarchive" : "Archive"}
                  </button>{" "}
                  <button className="btn" onClick={() => remove(b, false)}>
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
