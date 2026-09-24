import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, ApiError } from "../../api/client";
import { countriesByName, countryFlag, countryName } from "../../shared/countries";

/**
 * Top 3 contest review (/studio/contest). A queue on the left, the selected
 * entry on the right: listen, check the details (private ones marked), then
 * approve or reject. Approving and rejecting email the entrant, so both ask
 * for a second click. Keyboard: A approve, R reject, J/K next/previous.
 */

type Status = "pending" | "approved" | "rejected" | "unconfirmed" | "disqualified" | "withdrawn" | "all";
const TABS: { status: Status; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "unconfirmed", label: "Unconfirmed" },
  { status: "disqualified", label: "Disqualified" },
  { status: "withdrawn", label: "Withdrawn" },
  { status: "all", label: "All" },
];

const PRESET_REASONS = [
  "Audio quality isn't suitable for broadcast",
  "The song wasn't created or first released in 2026",
  "The song appears to include material you may not have the rights to use",
  "The song is a cover version",
  "The content breaks the competition rules",
];

// Keep in step with CONTEST.maxEntriesPerEntrant in worker/src/lib/contest.ts.
const MAX_ENTRIES = 1;
const clock = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "?");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "-");
const errText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong");

type Panel = null | "approve" | "reject" | "edit" | "disqualify" | "withdraw";

function Private() {
  return <span className="t3s-private">private</span>;
}

function EntryDetail({ id, onChanged }: { id: number; onChanged: (movedOn: boolean) => void }) {
  const [data, setData] = useState<{ entry: any; others: any[]; history: any[] } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const countries = useMemo(() => countriesByName(), []);

  const load = useCallback(() => {
    studioApi
      .contestEntry(id)
      .then(setData)
      .catch((err) => setError(errText(err)));
  }, [id]);

  useEffect(() => {
    setData(null);
    setPanel(null);
    setReason("");
    setError(null);
    setNotice(null);
    load();
  }, [load]);

  // A and R open the confirm panels; they're read by the page-level shortcut handler through this event.
  useEffect(() => {
    const open = (e: Event) => {
      const kind = (e as CustomEvent).detail as Panel;
      if (data?.entry.status !== "pending") return;
      setPanel(kind);
      setReason("");
      setError(null);
    };
    window.addEventListener("t3s-open-panel", open);
    return () => window.removeEventListener("t3s-open-panel", open);
  }, [data]);

  if (!data) return <div className="card">{error ? <p className="tc-error">{error}</p> : "Loading..."}</div>;
  const e = data.entry;
  const activeOthers = data.others.filter((o) => !["withdrawn", "rejected"].includes(o.status)).length;
  const bitrate = e.duration_seconds ? Math.round((e.audio_bytes * 8) / e.duration_seconds / 1000) : null;
  const warnings: string[] = [];
  if (e.created_or_released < "2026-01-01" || e.created_or_released > "2026-12-31") warnings.push("Date is outside 2026");
  if (e.duration_seconds && e.duration_seconds > 480) warnings.push("Longer than 8 minutes");
  if (!e.duration_seconds) warnings.push("The browser couldn't read the length - check it while listening");
  if (bitrate !== null && bitrate < 180) warnings.push(`Low bitrate (about ${bitrate} kbps)`);
  if (activeOthers + (["withdrawn", "rejected"].includes(e.status) ? 0 : 1) > MAX_ENTRIES)
    warnings.push(`This entrant has more than ${MAX_ENTRIES} active entries`);
  else if (MAX_ENTRIES > 1 && activeOthers >= MAX_ENTRIES - 1 && e.status === "pending") warnings.push(`This entrant already has ${activeOthers} other active entries`);

  const act = async (fn: () => Promise<unknown>, done: string, movedOn: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r: any = await fn();
      setPanel(null);
      setNotice(
        r?.inPublishedProgrammes?.length
          ? `${done} Warning: its library copy is still in published programme(s): ${r.inPublishedProgrammes.map((p: any) => p.title).join(", ")}.`
          : done
      );
      onChanged(movedOn);
      if (!movedOn) load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card t3s-detail">
      <div className="t3s-detail-head">
        <div>
          <div className="t3s-num">
            Song #{e.id} · <span className={`t3s-status t3s-${e.status}`}>{e.status}</span>
          </div>
          <h2 style={{ margin: "4px 0" }}>{e.title}</h2>
          <div style={{ color: "var(--text-dim)" }}>
            {e.creator_name} · {countryFlag(e.country_code)} {countryName(e.country_code)}
          </div>
        </div>
        {e.photo_key && <img className="t3s-photo" src={studioApi.contestEntryPhotoUrl(e.id)} alt="" />}
      </div>

      <audio key={e.id} controls preload="metadata" src={studioApi.contestEntryAudioUrl(e.id)} style={{ width: "100%", margin: "12px 0" }} />

      {warnings.length > 0 && (
        <ul className="t3s-warnings">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <dl className="t3s-fields">
        <dt>Length / size</dt>
        <dd>
          {clock(e.duration_seconds)} · {(e.audio_bytes / 1024 / 1024).toFixed(1)} MB{bitrate ? ` · about ${bitrate} kbps` : ""}
        </dd>
        <dt>Created or released</dt>
        <dd>{e.created_or_released}</dd>
        <dt>
          AI tools <Private />
        </dt>
        <dd className={e.ai_tools ? "t3s-flag" : undefined}>{e.ai_tools ?? "None declared"}</dd>
        <dt>
          Collecting society <Private />
        </dt>
        <dd className={e.collecting_society ? "t3s-flag" : undefined}>{e.collecting_society ?? "Not a member"}</dd>
        <dt>
          Legal name <Private />
        </dt>
        <dd>{e.legal_name}</dd>
        <dt>
          Email <Private />
        </dt>
        <dd>
          <a href={`mailto:${e.email}`}>{e.email}</a>
        </dd>
        <dt>Bio</dt>
        <dd>{e.bio ?? "-"}</dd>
        <dt>Links</dt>
        <dd>
          {e.links.length
            ? e.links.map((l: string) => (
                <div key={l}>
                  <a href={l} target="_blank" rel="nofollow noopener noreferrer">
                    {l}
                  </a>
                </div>
              ))
            : "-"}
        </dd>
        <dt>Received</dt>
        <dd>
          {day(e.created_at)}
          {e.confirmed_at ? ` · confirmed ${day(e.confirmed_at)}` : " · not confirmed yet"}
          {e.approved_at ? ` · approved ${day(e.approved_at)}` : ""}
        </dd>
        {e.status_reason && (
          <>
            <dt>Reason</dt>
            <dd>{e.status_reason}</dd>
          </>
        )}
        {e.status === "approved" && (
          <>
            <dt>Public page</dt>
            <dd>
              <a href={`/top3/${e.id}`} target="_blank" rel="noreferrer">
                weareradio.app/top3/{e.id}
              </a>
            </dd>
          </>
        )}
      </dl>

      {data.others.length > 0 && (
        <p className="t3s-others">
          Same entrant:{" "}
          {data.others.map((o, i) => (
            <span key={o.id}>
              {i > 0 && ", "}#{o.id} "{o.title}" ({o.status})
            </span>
          ))}
        </p>
      )}

      {notice && <p className="t3s-notice">{notice}</p>}
      {error && <p className="tc-error">{error}</p>}

      {panel === null && (
        <div className="t3s-actions">
          {e.status === "pending" && (
            <>
              <button className="btn primary" onClick={() => setPanel("approve")} title="Shortcut: A">
                Approve
              </button>
              <button className="btn" onClick={() => setPanel("reject")} title="Shortcut: R">
                Reject
              </button>
            </>
          )}
          <button
            className="btn"
            onClick={() => {
              setEdit({ title: e.title, creator_name: e.creator_name, country_code: e.country_code, bio: e.bio ?? "", links: e.links.join("\n") });
              setPanel("edit");
            }}
          >
            Edit details
          </button>
          {e.status === "approved" &&
            (e.library_track_id ? (
              <Link className="btn" to="/studio/tracks">
                In the library ✓
              </Link>
            ) : (
              <button className="btn" disabled={busy} onClick={() => act(() => studioApi.addContestEntryToLibrary(e.id), "Added to the library as a 'ready' track (not published), tagged creator-contest.", false)}>
                Add to library
              </button>
            ))}
          {e.status === "approved" && (
            <button className="btn" onClick={() => setPanel("disqualify")}>
              Disqualify
            </button>
          )}
          {["unconfirmed", "pending", "approved"].includes(e.status) && (
            <button className="btn" onClick={() => setPanel("withdraw")}>
              Withdraw
            </button>
          )}
        </div>
      )}

      {panel === "approve" && (
        <div className="t3s-panel">
          <p>
            Approve <strong>"{e.title}"</strong>? It goes live at /top3/{e.id} and <strong>{e.email}</strong> gets the "You're in the running" email.
          </p>
          <div className="t3s-actions">
            <button className="btn primary" disabled={busy} autoFocus onClick={() => act(() => studioApi.reviewContestEntry(e.id, "approve"), `Approved Song #${e.id}.`, true)}>
              {busy ? "Approving..." : "Yes, approve and email"}
            </button>
            <button className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "reject" && (
        <div className="t3s-panel">
          <p>
            Reject <strong>"{e.title}"</strong>? The reason below is included in the email to <strong>{e.email}</strong>.
          </p>
          {PRESET_REASONS.map((r) => (
            <label key={r} className="t3-check">
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> <span>{r}</span>
            </label>
          ))}
          <textarea
            rows={3}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="Or write your own reason (you can also edit a preset)"
            style={{ width: "100%", marginTop: 8 }}
          />
          <div className="t3s-actions">
            <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => act(() => studioApi.reviewContestEntry(e.id, "reject", reason), `Rejected Song #${e.id}.`, true)}>
              {busy ? "Rejecting..." : "Reject and email"}
            </button>
            <button className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(panel === "disqualify" || panel === "withdraw") && (
        <div className="t3s-panel">
          <p>
            {panel === "disqualify" ? "Disqualify" : "Withdraw"} <strong>"{e.title}"</strong>? It comes off the public site straight away.
            No email is sent - contact the entrant yourself.
          </p>
          <textarea
            rows={2}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder="Reason (for your records)"
            style={{ width: "100%" }}
          />
          <div className="t3s-actions">
            <button
              className="btn primary"
              disabled={busy || !reason.trim()}
              onClick={() => act(() => studioApi.removeContestEntry(e.id, panel, reason), panel === "disqualify" ? "Disqualified." : "Withdrawn.", false)}
            >
              {panel === "disqualify" ? "Disqualify" : "Withdraw"}
            </button>
            <button className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {panel === "edit" && (
        <div className="t3s-panel t3s-edit">
          <label>
            Title
            <input value={edit.title} maxLength={120} onChange={(ev) => setEdit({ ...edit, title: ev.target.value })} />
          </label>
          <label>
            Creator name
            <input value={edit.creator_name} maxLength={80} onChange={(ev) => setEdit({ ...edit, creator_name: ev.target.value })} />
          </label>
          <label>
            Country
            <select value={edit.country_code} onChange={(ev) => setEdit({ ...edit, country_code: ev.target.value })}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bio
            <textarea rows={3} maxLength={300} value={edit.bio} onChange={(ev) => setEdit({ ...edit, bio: ev.target.value })} />
          </label>
          <label>
            Links (one per line, https only)
            <textarea rows={3} value={edit.links} onChange={(ev) => setEdit({ ...edit, links: ev.target.value })} />
          </label>
          <div className="t3s-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    studioApi.updateContestEntry(e.id, {
                      ...edit,
                      links: edit.links.split("\n").map((l) => l.trim()).filter(Boolean),
                    }),
                  "Saved.",
                  false
                )
              }
            >
              Save
            </button>
            <button className="btn" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {data.history.length > 0 && (
        <details className="t3s-history">
          <summary>History ({data.history.length})</summary>
          <ul>
            {data.history.map((h, i) => (
              <li key={i}>
                {day(h.created_at)} - {h.action}
                {h.detail_json && h.detail_json !== "{}" ? ` ${h.detail_json}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Contest() {
  const [status, setStatus] = useState<Status>("pending");
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);

  const load = useCallback(
    (keepSelection = true) =>
      studioApi
        .contestEntries(status, q.trim() || undefined)
        .then((r) => {
          setEntries(r.entries);
          setCounts(r.counts);
          setError(null);
          setSelected((cur) => (keepSelection && cur && r.entries.some((e) => e.id === cur) ? cur : r.entries[0]?.id ?? null));
          return r.entries;
        })
        .catch((err) => {
          setError(errText(err));
          return [] as any[];
        }),
    [status, q]
  );

  useEffect(() => {
    const t = setTimeout(() => load(false), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    studioApi.contestStats().then(setStats).catch(() => {});
  }, [counts]);

  const index = entries.findIndex((e) => e.id === selected);
  const move = useCallback(
    (delta: number) => {
      if (entries.length === 0) return;
      const next = Math.min(entries.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      setSelected(entries[next].id);
    },
    [entries, index]
  );

  // After an approve/reject the entry leaves the Pending list: go to the next one in the queue.
  const onChanged = (movedOn: boolean) => {
    const nextId = movedOn ? entries[index + 1]?.id ?? entries[index - 1]?.id ?? null : selected;
    load().then((list) => {
      if (movedOn && status === "pending") setSelected(list.some((e) => e.id === nextId) ? nextId : list[0]?.id ?? null);
    });
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const key = ev.key.toLowerCase();
      if (key === "j") move(1);
      else if (key === "k") move(-1);
      else if (key === "a") window.dispatchEvent(new CustomEvent("t3s-open-panel", { detail: "approve" }));
      else if (key === "r") window.dispatchEvent(new CustomEvent("t3s-open-panel", { detail: "reject" }));
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ marginRight: "auto" }}>Top 3 Creator Songs of 2026</h1>
        <a className="btn" href={studioApi.contestExportUrl()}>
          Export CSV
        </a>
        <a className="btn" href="/top3" target="_blank" rel="noreferrer">
          Public page ↗
        </a>
      </div>

      {stats && (
        <p className="t3s-stats">
          {stats.byStatus.approved ?? 0} approved from {stats.approvedByCountry.length} countries · {stats.byStatus.pending ?? 0} waiting for
          review · {stats.byStatus.unconfirmed ?? 0} not yet confirmed by email · {stats.notify.confirmed} signed up for the voting reminder
          ({stats.notify.wantsNews} want news)
        </p>
      )}

      <div className="t3s-tabs">
        {TABS.map((t) => (
          <button key={t.status} className={`chip${status === t.status ? " selected" : ""}`} onClick={() => setStatus(t.status)}>
            {t.label}
            {t.status !== "all" && counts[t.status] ? ` (${counts[t.status]})` : ""}
          </button>
        ))}
        <input className="t3s-search" placeholder="Search title, creator, email or #" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <p className="t3s-keys">Keys: J / K next / previous · A approve · R reject</p>

      {error && <p className="tc-error">{error}</p>}

      <div className="t3s-layout">
        <div className="t3s-queue card">
          {entries.length === 0 && <p style={{ color: "var(--text-dim)" }}>Nothing here.</p>}
          {entries.map((e) => (
            <button key={e.id} className={`t3s-row${e.id === selected ? " selected" : ""}`} onClick={() => setSelected(e.id)}>
              <span className="t3s-row-num">#{e.id}</span>
              <span className="t3s-row-main">
                <strong>{e.title}</strong>
                <span>
                  {countryFlag(e.country_code)} {e.creator_name}
                </span>
              </span>
              <span className="t3s-row-meta">
                {day(e.confirmed_at ?? e.created_at)}
                <br />
                {clock(e.duration_seconds)}
              </span>
            </button>
          ))}
        </div>
        <div className="t3s-main">{selected !== null ? <EntryDetail id={selected} onChanged={onChanged} /> : null}</div>
      </div>
    </div>
  );
}
