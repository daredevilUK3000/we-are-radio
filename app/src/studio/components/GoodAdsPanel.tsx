import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";

/**
 * The Audio page's "For Good" tab (handoff_advertising_for_good.md §4A).
 * Advertising For Good ads are ordinary jingles marked AFG: they keep airing
 * exactly as before. This only decides how they appear on the site: title,
 * order, which one is featured on the landing page, and whether each is
 * shown at all.
 */

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

export function GoodAdsPanel({ jingles, onChanged }: { jingles: any[]; onChanged: () => void }) {
  const [ads, setAds] = useState<any[]>([]);
  const [cause, setCause] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    studioApi
      .goodAds()
      .then((r) => {
        setAds(r.ads);
        setCause(r.cause_enabled);
        setTitles(Object.fromEntries(r.ads.map((a: any) => [a.id, a.title])));
      })
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
    onChanged();
  };

  const saveTitle = (a: any) => {
    const next = (titles[a.id] ?? "").trim();
    if (!next || next === a.title) return setTitles((t) => ({ ...t, [a.id]: a.title }));
    run(() => studioApi.updateGoodAd(a.id, { title: next }));
  };

  const move = (index: number, by: number) => {
    const ids = ads.map((a) => a.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id);
    run(() => studioApi.orderGoodAds(ids));
  };

  const copyLink = async (slug: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/good/${slug}`).catch(() => {});
    setCopied(slug);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const shown = ads.filter((a) => a.afg_published && a.status === "published").length;
  const candidates = jingles.filter((a) => !a.afg && ["jingle", "station_id", "promo"].includes(a.type));

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="A jingle to add" style={{ maxWidth: 320 }}>
          <option value="">Add a jingle you've already uploaded...</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({clock(a.duration_seconds)})
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!adding}
          onClick={() => {
            const id = adding;
            setAdding("");
            run(() => studioApi.updateGoodAd(id, { afg: true }));
          }}
        >
          Add to For Good
        </button>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={cause}
            onChange={(e) => run(() => studioApi.setGoodSettings({ cause_enabled: e.target.checked }))}
          />
          Show "Got a cause?" on /good (asks charities to email info@weareradio.app)
        </label>
      </div>

      <p style={{ color: "var(--text-dim)" }}>
        {loaded && `${shown} showing on the site. `}
        The landing page plays the featured one and lists the next four in this order; /good shows them all.
      </p>
      {error && <p style={{ color: "var(--accent)" }}>{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Title</th>
            <th>Length</th>
            <th>On air</th>
            <th>On the site</th>
            <th>Featured</th>
            <th title="Plays of the preview on the site in the last 30 days (not station plays)">Previews (30 days)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ads.map((a, i) => (
            <Fragment key={a.id}>
              <tr>
                <td style={{ whiteSpace: "nowrap" }}>
                  {i + 1}{" "}
                  <button className="btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${a.title} up`}>
                    ↑
                  </button>{" "}
                  <button className="btn" disabled={i === ads.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${a.title} down`}>
                    ↓
                  </button>
                </td>
                <td>
                  <input
                    value={titles[a.id] ?? ""}
                    maxLength={80}
                    aria-label="Title"
                    onChange={(e) => setTitles((t) => ({ ...t, [a.id]: e.target.value }))}
                    onBlur={() => saveTitle(a)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td>{clock(a.duration_seconds)}</td>
                <td>
                  <span className={`badge${a.status === "published" ? " live" : ""}`}>{a.status === "published" ? "On air" : a.status}</span>
                </td>
                <td>
                  <button className="btn" onClick={() => run(() => studioApi.updateGoodAd(a.id, { afg_published: !a.afg_published }))}>
                    {a.afg_published ? "Showing · Hide" : "Hidden · Show"}
                  </button>
                </td>
                <td>
                  {a.afg_featured ? (
                    <span className="badge live">Featured</span>
                  ) : (
                    <button className="btn" onClick={() => run(() => studioApi.featureGoodAd(a.id))}>
                      Feature
                    </button>
                  )}
                </td>
                <td>{a.previews_30d}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => setPlayingId(playingId === a.id ? null : a.id)}>
                    {playingId === a.id ? "Hide player" : "Play"}
                  </button>
                  <button className="btn" onClick={() => copyLink(a.afg_slug)} title={`/good/${a.afg_slug}`}>
                    {copied === a.afg_slug ? "Copied" : "Copy link"}
                  </button>
                  <button className="btn" onClick={() => run(() => studioApi.updateGoodAd(a.id, { afg: false }))}>
                    Remove from For Good
                  </button>
                </td>
              </tr>
              {playingId === a.id && (
                <tr>
                  <td colSpan={8} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(a.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {loaded && ads.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "var(--text-dim)" }}>
                No Advertising For Good ads yet. <Link to="/studio/audio/upload?kind=good">Upload one</Link>, or add a jingle above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
        Removing an ad from For Good only takes it off the site; it keeps airing as a jingle. If an ad is ever taken off air it
        disappears from the site too. Each ad's link stays the same when you retitle it.
      </p>
    </div>
  );
}
