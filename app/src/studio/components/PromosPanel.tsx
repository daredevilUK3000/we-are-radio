import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl, uploadFileToR2 } from "../../api/client";

/**
 * The Audio page's "Promos" tab (handoff_house_promos.md §3): Kizzi's house
 * promos for the books he publishes and his platforms. They don't air as
 * jingles: each has a link (a button in the players, a QR code on the TV,
 * through its short link weareradio.app/go/<slug>) and its own rotation -
 * on/off, dates, channels, plays a day - plus the station-wide hourly limit.
 * Same pattern as GoodAdsPanel.tsx.
 */

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

type Channel = { id: string; name: string; slug: string };

interface Draft {
  on_air_title: string;
  link_url: string;
  link_label: string;
  slug: string;
  cover_url: string | null;
  active: boolean;
  runs_from: string;
  runs_to: string;
  max_per_day: number;
  all_channels: boolean;
  channel_ids: string[];
}

const draftOf = (p: any): Draft => ({
  on_air_title: p.on_air_title ?? p.title ?? "",
  link_url: p.link_url ?? "https://",
  link_label: p.link_label ?? "Find out more",
  slug: p.slug ?? slugify(p.on_air_title ?? p.title ?? ""),
  cover_url: p.cover_url ?? null,
  active: !!p.active,
  runs_from: p.runs_from ?? "",
  runs_to: p.runs_to ?? "",
  max_per_day: p.max_per_day ?? 4,
  all_channels: !p.channel_ids,
  channel_ids: p.channel_ids ?? [],
});

export function PromosPanel({ onChanged }: { onChanged: () => void }) {
  const [promos, setPromos] = useState<any[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [perHour, setPerHour] = useState(1);
  const [perHourMax, setPerHourMax] = useState(3);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = () =>
    studioApi
      .promos()
      .then((r) => {
        setPromos(r.promos);
        setChannels(r.channels);
        setPerHour(r.promos_per_hour);
        setPerHourMax(r.promos_per_hour_max);
      })
      .finally(() => setLoaded(true));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save");
      await load();
      return false;
    }
  };

  const openEdit = (p: any) => {
    setError(null);
    setEditing(p.id);
    setDraft(draftOf(p));
  };

  const save = async (id: string) => {
    if (!draft) return;
    setBusy(true);
    const ok = await run(() =>
      studioApi.savePromo(id, {
        on_air_title: draft.on_air_title,
        link_url: draft.link_url,
        link_label: draft.link_label,
        slug: draft.slug,
        cover_url: draft.cover_url,
        active: draft.active,
        runs_from: draft.runs_from || null,
        runs_to: draft.runs_to || null,
        max_per_day: Number(draft.max_per_day),
        channel_ids: draft.all_channels ? null : draft.channel_ids,
      })
    );
    setBusy(false);
    if (ok) {
      setEditing(null);
      setDraft(null);
    }
  };

  const uploadCover = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { upload_url, key } = await studioApi.presignUpload(file.name, file.type, "artwork");
      await uploadFileToR2(upload_url, file);
      setDraft((d) => (d ? { ...d, cover_url: key } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The cover didn't upload");
    } finally {
      setBusy(false);
    }
  };

  const channelNames = (ids: string[] | null) =>
    !ids ? "All live channels" : ids.map((id) => channels.find((c) => c.id === id)?.name ?? id).join(", ") || "None";
  const dates = (p: any) => (p.runs_from || p.runs_to ? `${p.runs_from ?? "…"} to ${p.runs_to ?? "…"}` : "Always");
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const linkOk = !!draft && /^https:\/\/[^\s/]+\.[^\s]+/i.test(draft.link_url.trim());

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          At most
          <select
            value={perHour}
            aria-label="Promos per hour on each channel"
            onChange={(e) => run(() => studioApi.setPromoSettings(Number(e.target.value)))}
            style={{ width: "auto" }}
          >
            {Array.from({ length: perHourMax + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          promo{perHour === 1 ? "" : "s"} an hour on each channel
        </label>
        {perHour === 0 && <span className="badge">All promos are paused</span>}
      </div>

      <p style={{ color: "var(--text-dim)" }}>
        Promos air between two songs on the autopilot channels, never next to a jingle, an Advertising For Good ad, a voice note or
        another promo, and at least 20 minutes apart. While one plays, the players show a button to its link and the TV shows a QR
        code. New promos start switched off: set the link and the cover, then switch them on.
      </p>
      {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      {loaded && promos.length === 0 && (
        <p>
          No promos yet. <Link to="/studio/promos/new">Make your first one, step by step</Link>.
        </p>
      )}

      {promos.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Promo</th>
              <th>On</th>
              <th>Dates</th>
              <th>Channels</th>
              <th title="Most plays a day, across all channels">Max a day</th>
              <th>Plays today</th>
              <th>Plays (7 days)</th>
              <th title="Clicks on the button, Just played, TV scans and the short link">Clicks (7 / 30 days)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {p.cover_url ? (
                        <img src={mediaUrl(p.cover_url)} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                      ) : (
                        <span style={{ width: 40, height: 40, borderRadius: 6, background: "rgba(240,161,42,0.2)", flex: "none" }} />
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.on_air_title ?? p.title}</div>
                        <div style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
                          {p.title} · {clock(p.duration_seconds)}
                          {p.short_url ? ` · ${p.short_url.replace(/^https:\/\//, "")}` : " · not set up yet"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!p.active}
                        onChange={(e) => run(() => studioApi.setPromoActive(p.id, e.target.checked))}
                        style={{ width: "auto" }}
                        aria-label={`${p.on_air_title ?? p.title} on air`}
                      />
                      {p.active ? "On" : "Off"}
                    </label>
                    {p.status !== "published" && <div className="badge">Audio is off air</div>}
                  </td>
                  <td>{dates(p)}</td>
                  <td>{channelNames(p.channel_ids)}</td>
                  <td>{p.max_per_day}</td>
                  <td>{p.plays_today}</td>
                  <td>{p.plays_7d}</td>
                  <td>
                    {p.clicks_7d} / {p.clicks_30d}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn" onClick={() => setPlayingId(playingId === p.id ? null : p.id)}>
                      {playingId === p.id ? "Stop" : "Play"}
                    </button>{" "}
                    {p.short_url ? (
                      <button className="btn" onClick={() => (editing === p.id ? setEditing(null) : openEdit(p))}>
                        {editing === p.id ? "Close" : "Edit"}
                      </button>
                    ) : (
                      <Link className="btn primary" to={`/studio/promos/new?id=${p.id}`}>
                        Set up
                      </Link>
                    )}
                  </td>
                </tr>
                {playingId === p.id && (
                  <tr>
                    <td colSpan={9}>
                      <audio src={mediaUrl(p.audio_url)} controls autoPlay onEnded={() => setPlayingId(null)} style={{ width: "100%" }} />
                    </td>
                  </tr>
                )}
                {editing === p.id && draft && (
                  <tr>
                    <td colSpan={9}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, padding: "8px 0" }}>
                        <div className="form-row">
                          <label>On-air title</label>
                          <input value={draft.on_air_title} maxLength={80} onChange={(e) => set({ on_air_title: e.target.value })} placeholder="Your Wedding Sorted!" />
                        </div>
                        <div className="form-row">
                          <label>Link (https://)</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input value={draft.link_url} maxLength={500} onChange={(e) => set({ link_url: e.target.value })} />
                            <a
                              className="btn"
                              href={linkOk ? draft.link_url.trim() : undefined}
                              target="_blank"
                              rel="noopener"
                              aria-disabled={!linkOk}
                              style={linkOk ? undefined : { opacity: 0.5, pointerEvents: "none" }}
                            >
                              Test link
                            </a>
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Button label</label>
                          <input value={draft.link_label} maxLength={30} onChange={(e) => set({ link_label: e.target.value })} placeholder="Get the book" />
                        </div>
                        <div className="form-row">
                          <label>Short link</label>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>weareradio.app/go/</span>
                            <input value={draft.slug} maxLength={40} onChange={(e) => set({ slug: slugify(e.target.value) })} placeholder="wedding" />
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Cover (optional)</label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {draft.cover_url && <img src={mediaUrl(draft.cover_url)} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover" }} />}
                            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
                            {draft.cover_url && (
                              <button className="btn" type="button" onClick={() => set({ cover_url: null })}>
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Runs from / to (optional, Paris dates)</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input type="date" value={draft.runs_from} onChange={(e) => set({ runs_from: e.target.value })} aria-label="Runs from" />
                            <input type="date" value={draft.runs_to} onChange={(e) => set({ runs_to: e.target.value })} aria-label="Runs to" />
                          </div>
                        </div>
                        <div className="form-row">
                          <label>Most plays a day (all channels)</label>
                          <input type="number" min={1} max={48} value={draft.max_per_day} onChange={(e) => set({ max_per_day: Number(e.target.value) })} />
                        </div>
                        <div className="form-row">
                          <label>Channels</label>
                          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input type="checkbox" checked={draft.all_channels} onChange={(e) => set({ all_channels: e.target.checked })} style={{ width: "auto" }} />
                            All live channels
                          </label>
                          {!draft.all_channels &&
                            channels.map((c) => (
                              <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={draft.channel_ids.includes(c.id)}
                                  onChange={(e) =>
                                    set({ channel_ids: e.target.checked ? [...draft.channel_ids, c.id] : draft.channel_ids.filter((x) => x !== c.id) })
                                  }
                                  style={{ width: "auto" }}
                                />
                                {c.name}
                              </label>
                            ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} style={{ width: "auto" }} />
                          On air
                        </label>
                        <button className="btn primary" disabled={busy} onClick={() => save(p.id)}>
                          {busy ? "Saving..." : "Save"}
                        </button>
                        <button className="btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
