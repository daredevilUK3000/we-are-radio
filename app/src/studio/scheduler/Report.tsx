import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { contentApi, friendly, schedApi, type DayReport, type OverviewChannel, type ReportRow } from "./api";
import { clock, hms, SchedulerNav } from "./common";
import { AiringHistory } from "./History";
import "./scheduler.css";
import "./timeline.css";
import "./content.css";

/**
 * Studio -> Scheduler -> Report (/studio/scheduler/report), Release 2 §9:
 * what the published plan said for a day beside what actually aired, row by
 * row, with who changed what and why. The CSV is the airplay evidence.
 */

const PARIS = "Europe/Paris";
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: PARIS }).format(new Date());
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const STATUS_CLASS: Record<ReportRow["status"], string> = {
  "As planned": "is-ok",
  Replaced: "is-change",
  Skipped: "is-change",
  Inserted: "is-change",
  Dropped: "is-warn",
  Trimmed: "is-change",
  Moved: "is-change",
  Late: "is-warn",
  "Not recorded": "is-dim",
};

export function Report() {
  const [params, setParams] = useSearchParams();
  const today = parisToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") && params.get("date")! <= today ? params.get("date")! : addDays(today, -1);
  const [channels, setChannels] = useState<OverviewChannel[]>([]);
  const slug = params.get("channel") ?? channels.find((c) => c.enabled)?.slug ?? channels[0]?.slug ?? null;
  const [report, setReport] = useState<DayReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "changes">("all");
  const [history, setHistory] = useState<{ airingId: string; label: string | null } | null>(null);

  useEffect(() => {
    schedApi
      .overview()
      .then((r) => setChannels(r.channels))
      .catch((e) => setErr(friendly(e)));
  }, []);
  useEffect(() => {
    if (!slug) return;
    setReport(null);
    setErr(null);
    contentApi
      .report(slug, date)
      .then(setReport)
      .catch((e) => setErr(friendly(e)));
  }, [slug, date]);

  const set = (patch: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...patch });
  const rows = (report?.rows ?? []).filter((r) => filter === "all" || r.status !== "As planned");
  const t = report?.totals;

  return (
    <div className="sch sch-report">
      <SchedulerNav />
      <header className="sch-tl-top">
        <h1 className="sch-h2">Scheduled versus aired</h1>
        <select className="sch-input sch-tl-channel" value={slug ?? ""} onChange={(e) => set({ channel: e.target.value })} aria-label="Channel">
          {channels.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
              {c.enabled ? "" : " (not on the Scheduler)"}
            </option>
          ))}
        </select>
        <div className="sch-tl-date">
          <button type="button" className="sch-icon-btn" aria-label="Previous day" onClick={() => set({ date: addDays(date, -1) })}>
            ‹
          </button>
          <input type="date" className="sch-input" value={date} max={today} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Date" />
          <button type="button" className="sch-icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => set({ date: addDays(date, 1) })}>
            ›
          </button>
        </div>
        <span className="sch-spacer" />
        {slug && report && (
          <a className="sch-btn" href={contentApi.reportCsvUrl(slug, date)} download>
            Export CSV
          </a>
        )}
      </header>
      {err && <p className="sch-error">{err}</p>}
      {!report && !err && <p className="sch-dim">Comparing…</p>}
      {report && t && (
        <>
          {!report.complete && <p className="sch-dim">Today so far: later items haven't aired yet.</p>}
          <dl className="sch-report-totals">
            <div>
              <dt>Aired as planned</dt>
              <dd>{t.as_planned_pct === null ? "–" : `${t.as_planned_pct}%`}</dd>
              <small className="sch-dim">
                {t.as_planned} of {t.planned}
              </small>
            </div>
            <div>
              <dt>Live changes</dt>
              <dd>{t.live_changes}</dd>
            </div>
            <div>
              <dt>Largest drift</dt>
              <dd>{t.largest_drift_ms < 1000 ? "None" : `${clock(t.largest_drift_ms)} min`}</dd>
            </div>
            <div>
              <dt>On the emergency playlist</dt>
              <dd>{t.fallback_ms < 1000 ? "None" : `${clock(t.fallback_ms)} min`}</dd>
            </div>
            <div>
              <dt>Songs aired</dt>
              <dd>{t.songs_aired}</dd>
              <small className="sch-dim">{t.unique_songs} different</small>
            </div>
          </dl>
          {t.not_recorded > 0 && <p className="sch-dim">{t.not_recorded} planned item{t.not_recorded === 1 ? "" : "s"} fell in a gap in the station's own record of what aired, so they're left out of the totals.</p>}
          <div className="sch-seg" role="radiogroup" aria-label="Show">
            <button type="button" role="radio" aria-checked={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
              Everything ({report.rows.length})
            </button>
            <button type="button" role="radio" aria-checked={filter === "changes"} className={filter === "changes" ? "is-on" : ""} onClick={() => setFilter("changes")}>
              Only differences ({report.rows.filter((r) => r.status !== "As planned").length})
            </button>
          </div>
          <div className="sch-report-wrap">
            <table className="sch-table sch-report-table">
              <thead>
                <tr>
                  <th scope="col">Planned</th>
                  <th scope="col">Aired</th>
                  <th scope="col">Status</th>
                  <th scope="col">Who and why</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="sch-dim">
                      {report.rows.length ? "Everything aired as planned." : "Nothing was planned or aired on this day."}
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.planned ? (
                        <>
                          <time className="sch-report-time">{hms(r.planned.at_ms)}</time> {r.planned.label}
                        </>
                      ) : (
                        <span className="sch-dim">–</span>
                      )}
                    </td>
                    <td>
                      {r.aired ? (
                        <>
                          <time className="sch-report-time">{hms(r.aired.at_ms)}</time> {r.aired.label}
                          {r.aired.source === "fallback" && <span className="sch-tl-badge">EMERGENCY</span>}
                        </>
                      ) : (
                        <span className="sch-dim">–</span>
                      )}
                    </td>
                    <td>
                      <span className={`sch-report-status ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                      {r.drift_ms !== null && Math.abs(r.drift_ms) > 1000 && <span className="sch-dim"> {r.drift_ms > 0 ? "+" : "−"}{clock(Math.abs(r.drift_ms))}</span>}
                    </td>
                    <td>
                      {r.who && <strong>{r.who}: </strong>}
                      <span className="sch-dim">{r.why ?? ""}</span>
                      {r.airing_id && r.status !== "As planned" && r.status !== "Not recorded" && slug && (
                        <button type="button" className="sch-linkbtn" onClick={() => setHistory({ airingId: r.airing_id!, label: r.aired?.label ?? r.planned?.label ?? null })}>
                          History
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {history && slug && <AiringHistory slug={slug} airingId={history.airingId} label={history.label} onClose={() => setHistory(null)} />}
    </div>
  );
}
