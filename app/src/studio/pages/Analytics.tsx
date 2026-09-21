import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { studioApi } from "../../api/client";
import { isOptedOut, setOptedOut } from "../../shared/analytics";
import {
  DataTable,
  HBars,
  Legend,
  RateCell,
  StatTile,
  TimeChart,
  ago,
  deltaOf,
  fmt,
  pct,
  seconds,
  type Col,
  type HBarRow,
  type Series,
} from "../components/AnalyticsCharts";

/**
 * Analytics: how many people are listening, to what, and whether Radio That
 * Knows You is landing. Its own full-width section of the Studio. Aggregate
 * only - nothing here identifies a listener. See worker/src/routes/analytics.ts.
 */

const PERIODS = [
  { days: 1, label: "Last 24 hours", short: "24 hours" },
  { days: 7, label: "7 days", short: "7 days" },
  { days: 30, label: "30 days", short: "30 days" },
  { days: 90, label: "90 days", short: "90 days" },
  { days: 365, label: "12 months", short: "12 months" },
  { days: 0, label: "All time", short: "all time" },
];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "mood", label: "Radio That Knows You" },
  { key: "content", label: "Top content" },
  { key: "skips", label: "Skips" },
  { key: "visitors", label: "Visitors" },
];

const MOODS: Record<string, { label: string; emoji: string; blurb: string }> = {
  energy: { label: "Energy", emoji: "⚡", blurb: "I need energy" },
  love: { label: "Love", emoji: "❤️", blurb: "I want to fall in love" },
  "switch-off": { label: "Switch off", emoji: "🌙", blurb: "I want to switch off" },
  fun: { label: "Fun", emoji: "🎉", blurb: "I want to have fun" },
};
const MOOD_ORDER = ["energy", "love", "switch-off", "fun"];

// Series colours live on .an-page in global.css (validated against the card surface).
const SONGS: Series = { key: "songs", label: "Songs played", color: "var(--an-songs)" };
const TUNE_INS: Series = { key: "tune_ins", label: "Channel tune-ins", color: "var(--an-tunein)" };
const PROGRAMMES: Series = { key: "programmes", label: "Programmes played", color: "var(--an-programmes)" };
const VISITS: Series = { key: "visits", label: "Visits", color: "var(--an-visits)" };

// A rate needs some plays behind it before it means anything.
const ENOUGH = 10;

export function Analytics() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "overview";
  const days = PERIODS.some((p) => String(p.days) === params.get("days")) ? Number(params.get("days")) : 30;
  const groupChoice = ["day", "week", "month"].includes(params.get("group") ?? "") ? params.get("group")! : "";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tableView, setTableView] = useState(false);
  const [optedOut, setOptedOutState] = useState(isOptedOut());

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
        return next;
      },
      { replace: true }
    );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await studioApi.analytics(days, groupChoice || undefined));
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the analytics");
    } finally {
      setLoading(false);
    }
  }, [days, groupChoice]);

  useEffect(() => {
    void load();
    // A quiet refresh every minute, so the launch surge can be watched as it happens.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const period = PERIODS.find((p) => p.days === days)!;
  const group: string = data?.period?.group ?? "day";
  const compare = days > 0 ? `previous ${period.short}` : "";

  return (
    <div className="an-page">
      <header className="an-header">
        <div>
          <h1>Analytics</h1>
          <p className="an-dim">
            What people play, finish and skip, and whether they're finding the station. Aggregate only: nothing here
            identifies a listener.
          </p>
        </div>
        <div className="an-updated an-dim">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString("en-GB")}` : "Loading..."}
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="an-controls">
        <div className="an-seg" role="group" aria-label="Time period">
          {PERIODS.map((p) => (
            // A new period goes back to the automatic grouping (days for a week, weeks for a month...).
            <button key={p.days} className={days === p.days ? "on" : ""} onClick={() => set({ days: String(p.days), group: null })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="an-seg" role="group" aria-label="Group by">
          <span className="an-seg-label">Group by</span>
          {["day", "week", "month"].map((g) => (
            <button key={g} className={group === g ? "on" : ""} onClick={() => set({ group: g })}>
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <nav className="an-tabs" role="tablist" aria-label="Analytics sections">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => set({ tab: t.key })}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <p style={{ color: "var(--accent)" }}>
          Couldn't load the analytics ({error}).{" "}
          <button className="btn" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {!data && !error && <p className="an-dim">Loading...</p>}

      {data && (
        <div className={loading ? "an-body refreshing" : "an-body"}>
          {tab === "overview" && (
            <Overview
              data={data}
              group={group}
              period={period}
              compare={compare}
              tableView={tableView}
              setTableView={setTableView}
              optedOut={optedOut}
              onOptOut={(v) => {
                setOptedOut(v);
                setOptedOutState(v);
              }}
            />
          )}
          {tab === "mood" && <MoodTab data={data} period={period} />}
          {tab === "content" && <ContentTab data={data} />}
          {tab === "skips" && <SkipsTab data={data} />}
          {tab === "visitors" && <VisitorsTab data={data} group={group} />}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ overview

function Overview({
  data,
  group,
  period,
  compare,
  tableView,
  setTableView,
  optedOut,
  onOptOut,
}: {
  data: any;
  group: string;
  period: { days: number; short: string };
  compare: string;
  tableView: boolean;
  setTableView: (v: boolean) => void;
  optedOut: boolean;
  onOptOut: (v: boolean) => void;
}) {
  const t = data.totals;
  const prev = data.previous;
  const noData = data.status.total_listening_events === 0 && data.status.total_site_events === 0;
  const finished = t.songs_completed + t.songs_skipped;

  const timelineCols: Col<any>[] = [
    { key: "bucket", label: group === "month" ? "Month" : group === "week" ? "Week starting" : "Day", value: (r) => r.bucket },
    { key: "songs", label: "Songs played", align: "right", value: (r) => r.songs },
    { key: "tune_ins", label: "Channel tune-ins", align: "right", value: (r) => r.tune_ins },
    { key: "programmes", label: "Programmes played", align: "right", value: (r) => r.programmes },
    { key: "visits", label: "Visits", align: "right", value: (r) => r.visits },
  ];

  return (
    <>
      <section className={`an-status ${noData ? "warn" : ""}`}>
        {noData ? (
          <p>
            <strong>Nothing has been recorded yet.</strong> Play a song on the site from a device that isn't switched to "don't
            count", then press Refresh. The first plays should appear within a minute.
          </p>
        ) : (
          <p>
            <strong>Logging is live.</strong> Last play recorded {ago(data.status.last_listening_event)}
            {data.status.last_site_event ? `, last visit ${ago(data.status.last_site_event)}` : ""}. Collecting since{" "}
            {data.status.collecting_since ?? "-"} ({fmt(data.status.total_listening_events)} play events,{" "}
            {fmt(data.status.total_site_events)} visit events so far).
          </p>
        )}
        <label className="an-check">
          <input type="checkbox" checked={optedOut} onChange={(e) => onOptOut(e.target.checked)} />
          Don't count my own listening on this device (so testing doesn't skew the numbers)
        </label>
      </section>

      <div className="an-tiles">
        <StatTile
          label="Songs played"
          value={fmt(t.songs_started)}
          delta={deltaOf(t.songs_started, prev?.songs_started, "count", true, compare)}
          note="every song that started, on any channel, album or programme"
        />
        <StatTile
          label="Channel tune-ins"
          value={fmt(t.tune_ins)}
          delta={deltaOf(t.tune_ins, prev?.tune_ins, "count", true, compare)}
          note="times someone pressed play on a live channel"
        />
        <StatTile
          label="Programmes played"
          value={fmt(t.programmes_started)}
          delta={deltaOf(t.programmes_started, prev?.programmes_started, "count", true, compare)}
          note="programmes, podcast episodes and Radio That Knows You sets"
        />
        <StatTile
          label="Visits"
          value={fmt(t.visits)}
          delta={deltaOf(t.visits, prev?.visits, "count", true, compare)}
          note="one per person per browser tab session"
        />
        <StatTile
          label="Songs heard to the end"
          value={pct(t.song_completion_rate)}
          delta={deltaOf(t.song_completion_rate, prev?.song_completion_rate, "rate", true, compare)}
          note={`of ${fmt(finished)} songs that finished or were left`}
        />
        <StatTile
          label="Songs skipped"
          value={pct(t.song_skip_rate)}
          delta={deltaOf(t.song_skip_rate, prev?.song_skip_rate, "rate", false, compare)}
          note="left, changed, or moved past before the end"
        />
      </div>

      <section className="an-card">
        <div className="an-card-head">
          <div>
            <h2>Plays over time</h2>
            <p className="an-dim">
              Per {group}, {period.days === 0 ? "since logging began" : `over the last ${period.short}`}. Times are UTC.
            </p>
          </div>
          <div className="an-seg small" role="group" aria-label="Chart or table">
            <button className={!tableView ? "on" : ""} onClick={() => setTableView(false)}>
              Chart
            </button>
            <button className={tableView ? "on" : ""} onClick={() => setTableView(true)}>
              Table
            </button>
          </div>
        </div>
        {tableView ? (
          <DataTable rows={[...data.series].reverse()} cols={timelineCols} filename={`plays-by-${group}`} empty="Nothing recorded yet." pageSize={31} />
        ) : (
          <>
            <Legend items={[SONGS, TUNE_INS, PROGRAMMES]} />
            <TimeChart
              data={data.series}
              series={[SONGS, TUNE_INS, PROGRAMMES]}
              group={group}
              kind="stacked"
              label={`Songs played, channel tune-ins and programmes played per ${group}`}
            />
          </>
        )}
      </section>

      <section className="an-card">
        <div className="an-card-head">
          <div>
            <h2>Visits over time</h2>
            <p className="an-dim">People opening the site, per {group}. This is what to watch on the day of an announcement.</p>
          </div>
        </div>
        {tableView ? null : <TimeChart data={data.series} series={[VISITS]} group={group} kind="line" height={200} label={`Visits per ${group}`} />}
        {tableView && <p className="an-dim">Visits are in the table above.</p>}
      </section>

      <section className="an-card an-help">
        <h2>How to read these numbers</h2>
        <ul>
          <li>
            <strong>There is no "listeners" number, on purpose.</strong> With no accounts and no tracking of people, the site can
            count plays and visits but not who is who. Visits (one per browser tab session) is the nearest thing to a headcount.
          </li>
          <li>
            <strong>Heard to the end</strong> means the song played out (or was left in its last two seconds).{" "}
            <strong>Skipped</strong> means the listener pressed next, chose something else, changed channel or left the page
            first. Pausing is never counted as a skip, and neither is joining a live song part-way through.
          </li>
          <li>Percentages only count plays that ended one way or the other, so a song still playing can't drag them down.</li>
          <li>Small numbers mislead: a rate based on fewer than {ENOUGH} plays is marked "few plays".</li>
        </ul>
      </section>
    </>
  );
}

// ------------------------------------------------------ Radio That Knows You

function MoodTab({ data, period }: { data: any; period: { short: string } }) {
  const byMood: Record<string, any> = Object.fromEntries(data.radio_for_you.moods.map((m: any) => [m.mood, m]));
  const moods = MOOD_ORDER.map((k) => byMood[k]).filter(Boolean);
  const anyData = moods.length > 0;

  const finishRows: HBarRow[] = MOOD_ORDER.map((k) => {
    const m = byMood[k];
    const done = m ? m.programmes_finished + m.programmes_abandoned : 0;
    return {
      key: k,
      label: `${MOODS[k].emoji} ${MOODS[k].label}`,
      sub: done < ENOUGH ? `few plays (${done})` : `${done} programmes`,
      bars: [
        {
          color: "var(--an-bar)",
          value: m?.programme_finish_rate ?? 0,
          display: m?.programme_finish_rate == null ? "no data" : pct(m.programme_finish_rate),
          name: "Programmes heard to the end",
        },
      ],
      detail: m
        ? [
            `${fmt(m.programmes_started)} started, ${fmt(m.programmes_finished)} finished, ${fmt(m.programmes_abandoned)} left early`,
          ]
        : ["Nobody has picked this mood in this period"],
    };
  });

  const songRows: HBarRow[] = MOOD_ORDER.map((k) => {
    const m = byMood[k];
    return {
      key: k,
      label: `${MOODS[k].emoji} ${MOODS[k].label}`,
      sub: m ? `${m.main_songs} regular · ${m.wildcard_songs} wildcard` : undefined,
      bars: [
        {
          color: "var(--an-regular)",
          value: m?.main_completion_rate ?? 0,
          display: m?.main_completion_rate == null ? "no data" : pct(m.main_completion_rate),
          name: "Regular songs heard to the end",
        },
        {
          color: "var(--an-wildcard)",
          value: m?.wildcard_completion_rate ?? 0,
          display: m?.wildcard_completion_rate == null ? "no data" : pct(m.wildcard_completion_rate),
          name: "Wildcard songs heard to the end",
        },
      ],
      detail: m ? [`${m.wildcard_songs} wildcard and ${m.main_songs} regular songs finished or left`] : undefined,
    };
  });

  // Plain-English reading of the numbers, only once there's enough behind them.
  const solid = moods.filter((m) => m.programmes_finished + m.programmes_abandoned >= ENOUGH);
  const insights: string[] = [];
  if (solid.length >= 2) {
    const sorted = [...solid].sort((a, b) => (a.programme_finish_rate ?? 0) - (b.programme_finish_rate ?? 0));
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    if ((best.programme_finish_rate ?? 0) - (worst.programme_finish_rate ?? 0) >= 10) {
      insights.push(
        `Listeners who pick ${MOODS[worst.mood].label} hear ${pct(worst.programme_finish_rate)} of their programmes to the end, against ${pct(best.programme_finish_rate)} for ${MOODS[best.mood].label}. ${MOODS[worst.mood].label} is where people are leaving.`
      );
    }
  }
  for (const m of moods) {
    if (m.wildcard_songs >= ENOUGH && m.main_songs >= ENOUGH && (m.main_completion_rate ?? 0) - (m.wildcard_completion_rate ?? 0) >= 15) {
      insights.push(
        `In ${MOODS[m.mood].label}, wildcard songs are heard to the end ${pct(m.wildcard_completion_rate)} of the time against ${pct(m.main_completion_rate)} for regular ones, so the surprise picks look like the cause. Check the wildcard tags for this mood.`
      );
    } else if (m.songs_completed + m.songs_skipped >= ENOUGH && (m.song_completion_rate ?? 100) < 60) {
      insights.push(
        `${MOODS[m.mood].label}: only ${pct(m.song_completion_rate)} of songs are heard to the end, even the regular ones. The songs tagged for this mood may not suit it.`
      );
    }
  }

  const loseCols: Col<any>[] = [
    { key: "title", label: "Song", value: (r) => r.title ?? "(removed)", render: (r) => <strong>{r.title ?? "(removed)"}</strong> },
    { key: "mood", label: "Mood", value: (r) => MOODS[r.mood]?.label ?? r.mood },
    {
      key: "kind",
      label: "Pick",
      value: (r) => (r.is_wildcard ? "Wildcard" : "Regular"),
      render: (r) => <span className={`badge${r.is_wildcard ? " live" : ""}`}>{r.is_wildcard ? "wildcard" : "regular"}</span>,
      help: "A wildcard is the occasional surprise pick from outside the mood's usual tags",
    },
    { key: "plays", label: "Plays", align: "right", value: (r) => r.plays },
    { key: "completed", label: "Heard to end", align: "right", value: (r) => r.completed },
    { key: "skipped", label: "Skipped", align: "right", value: (r) => r.skipped },
    {
      key: "rate",
      label: "Heard to the end",
      value: (r) => r.finished_rate,
      render: (r) => <RateCell value={r.finished_rate} />,
    },
  ];

  const moodCols: Col<any>[] = [
    { key: "mood", label: "Mood", value: (r) => MOODS[r.mood]?.label ?? r.mood, render: (r) => <strong>{MOODS[r.mood]?.emoji} {MOODS[r.mood]?.label ?? r.mood}</strong> },
    { key: "ps", label: "Programmes started", align: "right", value: (r) => r.programmes_started },
    { key: "pf", label: "Finished", align: "right", value: (r) => r.programmes_finished },
    { key: "pa", label: "Left early", align: "right", value: (r) => r.programmes_abandoned },
    { key: "pr", label: "Programmes finished", value: (r) => r.programme_finish_rate, render: (r) => <RateCell value={r.programme_finish_rate} /> },
    { key: "ss", label: "Songs started", align: "right", value: (r) => r.songs_started },
    { key: "sc", label: "Heard to end", align: "right", value: (r) => r.songs_completed },
    { key: "sk", label: "Skipped", align: "right", value: (r) => r.songs_skipped },
    { key: "sr", label: "Songs heard to end", value: (r) => r.song_completion_rate, render: (r) => <RateCell value={r.song_completion_rate} /> },
    { key: "mr", label: "Regular songs", value: (r) => r.main_completion_rate, render: (r) => <RateCell value={r.main_completion_rate} color="var(--an-regular)" /> },
    { key: "wr", label: "Wildcard songs", value: (r) => r.wildcard_completion_rate, render: (r) => <RateCell value={r.wildcard_completion_rate} color="var(--an-wildcard)" /> },
    { key: "as", label: "Avg. seconds in when skipped", align: "right", value: (r) => r.avg_seconds_when_skipped, render: (r) => seconds(r.avg_seconds_when_skipped) },
  ];

  return (
    <>
      <section className="an-card an-hero">
        <h2>Do listeners stay? Radio That Knows You, mood by mood</h2>
        <p className="an-dim">
          For each of the four moods: how often a whole programme is heard to the end, and how the surprise "wildcard" songs do
          against the regular ones. If listeners who pick a mood keep bailing out part-way, that mood's song pool or its wildcard
          mechanic needs attention. Showing {period.short === "all time" ? "all time" : `the last ${period.short}`}.
        </p>
        {!anyData && (
          <p className="an-status warn">
            <strong>No Radio That Knows You plays recorded in this period yet.</strong> They will appear here as soon as someone
            picks a mood on the site.
          </p>
        )}
        {insights.length > 0 && (
          <ul className="an-insights">
            {insights.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        {anyData && insights.length === 0 && (
          <p className="an-dim">
            Not enough plays yet to say anything firm: it takes at least {ENOUGH} finished or abandoned programmes in a mood before
            its percentages are worth acting on. The numbers below are still real, just small.
          </p>
        )}
      </section>

      <div className="an-moodcards">
        {MOOD_ORDER.map((k) => {
          const m = byMood[k];
          const done = m ? m.programmes_finished + m.programmes_abandoned : 0;
          return (
            <div className="an-card an-moodcard" key={k}>
              <div className="an-moodcard-title">
                <span aria-hidden="true">{MOODS[k].emoji}</span> {MOODS[k].blurb}
              </div>
              <div className="an-tile-value">{m ? pct(m.programme_finish_rate) : "-"}</div>
              <div className="an-tile-note">of programmes heard to the end</div>
              <dl>
                <dt>Programmes started</dt>
                <dd>{fmt(m?.programmes_started ?? 0)}</dd>
                <dt>Finished / left early</dt>
                <dd>
                  {fmt(m?.programmes_finished ?? 0)} / {fmt(m?.programmes_abandoned ?? 0)}
                </dd>
                <dt>Songs heard to the end</dt>
                <dd>{pct(m?.song_completion_rate)}</dd>
                <dt>Wildcards heard to the end</dt>
                <dd>{pct(m?.wildcard_completion_rate)}</dd>
              </dl>
              {m && done < ENOUGH && <span className="badge">few plays - too early to trust</span>}
            </div>
          );
        })}
      </div>

      <div className="an-two">
        <section className="an-card">
          <h2>Programmes heard to the end</h2>
          <p className="an-dim">The share of programmes played out to the last item. Lower means more people leave part-way.</p>
          <HBars rows={finishRows} max={100} />
        </section>
        <section className="an-card">
          <h2>Songs heard to the end: regular vs wildcard</h2>
          <p className="an-dim">Are the surprise picks what makes people leave?</p>
          <Legend items={[{ label: "Regular songs", color: "var(--an-regular)" }, { label: "Wildcard songs", color: "var(--an-wildcard)" }]} />
          <HBars rows={songRows} max={100} />
        </section>
      </div>

      <section className="an-card">
        <h2>All the numbers</h2>
        <DataTable rows={moods} cols={moodCols} filename="radio-that-knows-you-by-mood" empty="No Radio That Knows You plays recorded in this period yet." />
      </section>

      <section className="an-card">
        <h2>Songs that lose people</h2>
        <p className="an-dim">
          Songs played inside Radio That Knows You, worst first, that have been finished or left at least 3 times in a mood. A song
          near the top is a candidate to re-tag or take out of that mood.
        </p>
        <DataTable
          rows={data.radio_for_you.songs_that_lose_people}
          cols={loseCols}
          initialSort={{ key: "rate", dir: "asc" }}
          filename="radio-that-knows-you-songs"
          searchText={(r) => `${r.title} ${r.mood}`}
          empty="No song has been finished or left 3 times in a mood yet."
        />
      </section>
    </>
  );
}

// -------------------------------------------------------------- top content

function ContentTab({ data }: { data: any }) {
  const maxPlays = Math.max(...data.top_tracks.map((t: any) => t.plays), 1);
  const trackCols: Col<any>[] = [
    { key: "title", label: "Track", value: (r) => r.title ?? "(removed)", render: (r) => <strong>{r.title ?? "(removed)"}</strong> },
    { key: "artist", label: "Artist", value: (r) => r.artist },
    { key: "album", label: "Album", value: (r) => r.album },
    {
      key: "plays",
      label: "Plays",
      value: (r) => r.plays,
      render: (r) => (
        <span className="an-rate">
          <span className="an-rate-track wide">
            <span style={{ width: `${(r.plays / maxPlays) * 100}%`, background: "var(--an-songs)" }} />
          </span>
          <span>{fmt(r.plays)}</span>
        </span>
      ),
    },
    { key: "completed", label: "Heard to end", align: "right", value: (r) => r.completed },
    { key: "skipped", label: "Skipped", align: "right", value: (r) => r.skipped },
    { key: "rate", label: "Heard to the end", value: (r) => r.finished_rate, render: (r) => <RateCell value={r.finished_rate} /> },
  ];
  const programmeCols: Col<any>[] = [
    { key: "title", label: "Programme", value: (r) => r.title ?? "(removed)", render: (r) => <strong>{r.title ?? "(removed)"}</strong> },
    { key: "show", label: "Show", value: (r) => r.show_name },
    { key: "plays", label: "Plays", align: "right", value: (r) => r.plays },
    { key: "completed", label: "Played to the end", align: "right", value: (r) => r.completed },
    { key: "abandoned", label: "Left early", align: "right", value: (r) => r.abandoned },
    { key: "rate", label: "Played to the end", value: (r) => r.finished_rate, render: (r) => <RateCell value={r.finished_rate} /> },
  ];
  const channelRows: HBarRow[] = data.channels.map((c: any) => ({
    key: c.id,
    label: c.name ?? c.id,
    sub: `${fmt(c.song_plays)} songs played`,
    bars: [{ color: "var(--an-tunein)", value: c.tune_ins, display: fmt(c.tune_ins), name: "Tune-ins" }],
    detail: [`${fmt(c.songs_completed)} songs heard to the end, ${fmt(c.songs_skipped)} skipped (${pct(c.finished_rate)} to the end)`],
  }));
  const channelCols: Col<any>[] = [
    { key: "name", label: "Channel", value: (r) => r.name ?? r.id, render: (r) => <strong>{r.name ?? r.id}</strong> },
    { key: "tune", label: "Tune-ins", align: "right", value: (r) => r.tune_ins },
    { key: "songs", label: "Songs played", align: "right", value: (r) => r.song_plays },
    { key: "done", label: "Heard to end", align: "right", value: (r) => r.songs_completed },
    { key: "skipped", label: "Skipped", align: "right", value: (r) => r.songs_skipped },
    { key: "rate", label: "Heard to the end", value: (r) => r.finished_rate, render: (r) => <RateCell value={r.finished_rate} /> },
  ];

  return (
    <>
      <section className="an-card">
        <h2>Top tracks</h2>
        <p className="an-dim">Every song that started, from any channel, album, programme or mix. Click a heading to sort.</p>
        <DataTable rows={data.top_tracks} cols={trackCols} initialSort={{ key: "plays", dir: "desc" }} filename="top-tracks" searchText={(r) => `${r.title} ${r.artist} ${r.album}`} empty="No songs played in this period yet." />
      </section>
      <div className="an-two">
        <section className="an-card">
          <h2>Channels</h2>
          <p className="an-dim">Tune-ins: times someone pressed play on the channel.</p>
          {channelRows.length > 0 ? <HBars rows={channelRows} /> : <p className="an-dim an-empty">No channel plays in this period yet.</p>}
        </section>
        <section className="an-card">
          <h2>Channel detail</h2>
          <DataTable rows={data.channels} cols={channelCols} initialSort={{ key: "tune", dir: "desc" }} filename="channels" empty="No channel plays in this period yet." />
        </section>
      </div>
      <section className="an-card">
        <h2>Top programmes and podcast episodes</h2>
        <p className="an-dim">Plays started from a programme or podcast page (Radio That Knows You is on its own tab).</p>
        <DataTable rows={data.top_programmes} cols={programmeCols} initialSort={{ key: "plays", dir: "desc" }} filename="top-programmes" searchText={(r) => `${r.title} ${r.show_name ?? ""}`} empty="No programmes played in this period yet." />
      </section>
    </>
  );
}

// -------------------------------------------------------------------- skips

function SkipsTab({ data }: { data: any }) {
  const rows = data.most_skipped;
  const cols: Col<any>[] = [
    { key: "title", label: "Track", value: (r) => r.title ?? "(removed)", render: (r) => <strong>{r.title ?? "(removed)"}</strong> },
    { key: "artist", label: "Artist", value: (r) => r.artist },
    { key: "album", label: "Album", value: (r) => r.album },
    { key: "plays", label: "Plays", align: "right", value: (r) => r.plays },
    { key: "skipped", label: "Skipped", align: "right", value: (r) => r.skipped },
    { key: "rate", label: "Skip rate", value: (r) => r.skip_rate, render: (r) => <RateCell value={r.skip_rate} color="var(--an-skip)" />, help: "Skipped as a share of plays that ended" },
    {
      key: "secs",
      label: "Usually left after",
      align: "right",
      value: (r) => r.avg_seconds_when_skipped,
      render: (r) => seconds(r.avg_seconds_when_skipped),
      help: "Average time into the song when it was skipped. A few seconds means an instant skip.",
    },
    { key: "few", label: "", value: (r) => (r.completed + r.skipped < ENOUGH ? "few plays" : ""), render: (r) => (r.completed + r.skipped < ENOUGH ? <span className="badge">few plays</span> : null) },
  ];
  return (
    <section className="an-card">
      <h2>Most skipped tracks</h2>
      <p className="an-dim">
        Regular listening: channels, albums, programmes and My Mood (Radio That Knows You has its own tab). Only songs that have
        finished or been left at least 3 times are listed. "Usually left after" separates an instant skip (a few seconds) from a
        song people give up on part-way. Skipped means the listener moved on before the end; pausing never counts.
      </p>
      <DataTable rows={rows} cols={cols} initialSort={{ key: "rate", dir: "desc" }} filename="most-skipped-tracks" searchText={(r) => `${r.title} ${r.artist} ${r.album}`} empty="No song has been finished or left 3 times yet, so there's nothing to rank." />
    </section>
  );
}

// ----------------------------------------------------------------- visitors

function VisitorsTab({ data, group }: { data: any; group: string }) {
  const f = data.funnel;
  const stages = [
    { key: "visits", label: "Visited the site", value: f.visits, name: "Visits" },
    { key: "listen", label: "Pressed Listen Now", value: f.pressed_listen_now, name: "Pressed Listen Now" },
    { key: "played", label: "Played something", value: f.played_something, name: "Played something" },
  ];
  const rows: HBarRow[] = stages.map((s, i) => ({
    key: s.key,
    label: s.label,
    sub: i === 0 ? "100% of visits" : `${pct(f.visits ? (s.value / f.visits) * 100 : null)} of visits`,
    bars: [{ color: "var(--an-bar)", value: s.value, display: fmt(s.value), name: s.name }],
    detail:
      i === 0
        ? undefined
        : [`${pct(stages[i - 1].value ? (s.value / stages[i - 1].value) * 100 : null)} of those who reached "${stages[i - 1].label}"`],
  }));
  const cols: Col<any>[] = [
    { key: "source", label: "Where they came from", value: (r) => r.source, render: (r) => <strong>{r.source}</strong>, help: "utm_source on the link if there was one, otherwise the referring site, otherwise direct" },
    { key: "visits", label: "Visits", align: "right", value: (r) => r.visits },
    { key: "listen", label: "Pressed Listen Now", align: "right", value: (r) => r.pressed_listen_now },
    { key: "played", label: "Played something", align: "right", value: (r) => r.played },
    { key: "rate", label: "Visits that led to a play", value: (r) => (r.visits ? (r.played / r.visits) * 100 : null), render: (r) => <RateCell value={r.visits ? (r.played / r.visits) * 100 : null} /> },
  ];
  return (
    <>
      <div className="an-two">
        <section className="an-card">
          <h2>Visit to listen</h2>
          <p className="an-dim">
            Of everyone who opened the site, how many pressed Listen Now, and how many played something (by any route: the
            homepage, an album, a mood, a channel). People who play without Listen Now still count as "played something".
          </p>
          {f.visits > 0 ? <HBars rows={rows} /> : <p className="an-dim an-empty">No visits recorded in this period yet.</p>}
        </section>
        <section className="an-card">
          <h2>Visits over time</h2>
          <p className="an-dim">Per {group}.</p>
          <TimeChart data={data.series} series={[VISITS]} group={group} kind="line" height={220} label={`Visits per ${group}`} />
        </section>
      </div>
      <section className="an-card">
        <h2>Where visitors come from</h2>
        <p className="an-dim">
          To see which announcement is working, put <code>?utm_source=youtube</code> (or <code>podcast</code>, <code>newsletter</code>,
          <code> sussex-newspaper</code>...) on the end of the link you share. Links without it are grouped by the website they came from,
          or "direct" (typed in, bookmarked, or from an app that hides where it came from).
        </p>
        <DataTable rows={f.sources} cols={cols} initialSort={{ key: "visits", dir: "desc" }} filename="visit-sources" empty="No visits recorded in this period yet." />
      </section>
    </>
  );
}
