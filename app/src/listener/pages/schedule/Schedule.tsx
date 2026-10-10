import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "./schedule.css";

/**
 * /schedule - "What's on": the next 7 days of named shows on every live
 * channel, from the published plans (/api/guide), in the listener's own time
 * zone (or Paris, with the toggle). Each show can go into a calendar.
 */

interface Slot {
  block_id: string | null;
  name: string;
  description: string;
  starts_at: number;
  ends_at: number;
  recurring: string | null;
  kind: "show" | "music" | "default";
  calendar?: { ics: string; google: string | null };
}
interface GuideChannel {
  slug: string;
  name: string;
  accent: string;
  slots: Slot[];
}

const API = import.meta.env.VITE_API_ORIGIN ?? "";
const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
  } catch {
    return "Europe/Paris";
  }
})();
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: fine */
    }
  },
};

function dateIn(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (date: string, n: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);
const weekdayOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

export function Schedule() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ generated_at: number; channels: GuideChannel[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [paris, setParis] = useState(() => store.get("sch-pub-paris") === "1");
  const [grid, setGrid] = useState(() => store.get("sch-pub-grid") === "1");
  const [now, setNow] = useState(Date.now());
  const tz = paris ? "Europe/Paris" : LOCAL_TZ;
  const today = dateIn(now, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const dayParam = params.get("day");
  const dayIdx = Math.max(0, dayParam ? (DAY_KEYS.includes(dayParam) ? days.findIndex((d) => DAY_KEYS[weekdayOf(d)] === dayParam) : days.indexOf(dayParam)) : 0);
  const day = days[dayIdx] ?? today;
  const [channel, setChannel] = useState<string>(() => params.get("channel") ?? store.get("sch-pub-channel") ?? "all");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const prev = document.title;
    document.title = "What's on · We Are Radio";
    return () => {
      document.title = prev;
    };
  }, []);
  useEffect(() => {
    const load = () =>
      fetch(`${API}/api/guide?days=7`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d) => {
          setData(d);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    load();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    const r = window.setInterval(load, 5 * 60_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(r);
    };
  }, []);

  const fmtTime = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "2-digit", minute: "2-digit" }), [tz]);
  const t = (sec: number) => fmtTime.format(new Date(sec * 1000));
  const tabLabel = (d: string, i: number) =>
    i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const longDay = (d: string) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

  const pickDay = (i: number) => {
    const p = new URLSearchParams(params);
    if (i === 0) p.delete("day");
    else p.set("day", DAY_KEYS[weekdayOf(days[i])]);
    setParams(p, { replace: true });
  };
  const pickChannel = (slug: string) => {
    setChannel(slug);
    store.set("sch-pub-channel", slug);
    const p = new URLSearchParams(params);
    if (slug === "all") p.delete("channel");
    else p.set("channel", slug);
    setParams(p, { replace: true });
  };

  // Swipe between days on a phone.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) pickDay(Math.max(0, Math.min(6, dayIdx + (dx < 0 ? 1 : -1))));
  };

  const nowSec = now / 1000;
  const channels = (data?.channels ?? []).filter((c) => channel === "all" || c.slug === channel);
  const slotsFor = (c: GuideChannel) => c.slots.filter((s) => dateIn(s.starts_at * 1000, tz) === day || (dateIn(s.ends_at * 1000 - 1, tz) === day && dateIn(s.starts_at * 1000, tz) < day));
  const onNow = (data?.channels ?? []).map((c) => ({ c, s: c.slots.find((s) => s.starts_at <= nowSec && nowSec < s.ends_at) ?? null }));

  if (failed && !data) {
    return (
      <div className="sch-pub">
        <Hero tz={tz} paris={paris} setParis={() => {}} />
        <p className="sch-pub-empty">
          The schedule couldn't load just now. <Link to="/listen">Listen live</Link> while we sort it out.
        </p>
      </div>
    );
  }
  if (data && data.channels.length === 0) {
    return (
      <div className="sch-pub">
        <Hero tz={tz} paris={paris} setParis={() => {}} />
        <p className="sch-pub-empty">
          The schedule is coming soon. <Link to="/listen">Listen live</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="sch-pub">
      <Hero
        tz={tz}
        paris={paris}
        setParis={(v) => {
          setParis(v);
          store.set("sch-pub-paris", v ? "1" : "0");
        }}
      />

      <section className="sch-pub-onnow" aria-label="On now">
        {!data
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="sch-pub-onnow-card is-loading" />)
          : onNow.map(({ c, s }) => (
              <div key={c.slug} className="sch-pub-onnow-card" style={{ ["--acc" as string]: c.accent }}>
                <span className="sch-pub-onnow-ch">{c.name}</span>
                <strong>{s ? s.name : c.name}</strong>
                {s && (
                  <span className="sch-pub-dim">
                    until {t(s.ends_at)}
                    <span className="sch-pub-progress" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, ((nowSec - s.starts_at) / (s.ends_at - s.starts_at)) * 100)}%` }} />
                    </span>
                  </span>
                )}
                <Link className="sch-pub-listen" to={`/channel/${c.slug}`} aria-label={`Listen to ${c.name} live`}>
                  <span aria-hidden="true">▶</span> Listen
                </Link>
              </div>
            ))}
      </section>

      <div className="sch-pub-sticky">
        <div className="sch-pub-tabs" role="tablist" aria-label="Day">
          {days.map((d, i) => (
            <button
              key={d}
              ref={(el) => (tabs.current[i] = el)}
              role="tab"
              id={`sch-pub-tab-${i}`}
              aria-selected={i === dayIdx}
              aria-controls="sch-pub-panel"
              tabIndex={i === dayIdx ? 0 : -1}
              className={i === dayIdx ? "is-on" : ""}
              onClick={() => pickDay(i)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const n = (dayIdx + step + 7) % 7;
                pickDay(n);
                tabs.current[n]?.focus();
              }}
            >
              {tabLabel(d, i)}
            </button>
          ))}
        </div>
        <div className="sch-pub-filters">
          <div className="sch-pub-chips" role="group" aria-label="Channels">
            <button type="button" className={channel === "all" ? "is-on" : ""} aria-pressed={channel === "all"} onClick={() => pickChannel("all")}>
              All
            </button>
            {(data?.channels ?? []).map((c) => (
              <button
                key={c.slug}
                type="button"
                className={channel === c.slug ? "is-on" : ""}
                aria-pressed={channel === c.slug}
                style={{ ["--acc" as string]: c.accent }}
                onClick={() => pickChannel(c.slug)}
              >
                <i aria-hidden="true" /> {c.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`sch-pub-gridtoggle${grid ? " is-on" : ""}`}
            aria-pressed={grid}
            onClick={() => {
              setGrid(!grid);
              store.set("sch-pub-grid", grid ? "0" : "1");
            }}
          >
            {grid ? "List" : "Grid"}
          </button>
        </div>
      </div>

      <div id="sch-pub-panel" role="tabpanel" aria-labelledby={`sch-pub-tab-${dayIdx}`} className="sch-pub-panel" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <h2 className="sch-pub-day">{longDay(day)}</h2>
        {!data ? (
          <p className="sch-pub-dim">Loading the schedule…</p>
        ) : grid ? (
          <DayGrid channels={channels} day={day} tz={tz} nowSec={nowSec} t={t} slotsFor={slotsFor} />
        ) : (
          channels.map((c) => <ChannelDay key={c.slug} c={c} slots={slotsFor(c)} nowSec={nowSec} t={t} isToday={dayIdx === 0} />)
        )}
      </div>
    </div>
  );
}

function Hero({ tz, paris, setParis }: { tz: string; paris: boolean; setParis: (v: boolean) => void }) {
  return (
    <header className="sch-pub-hero">
      <p className="sch-pub-eyebrow">Schedule</p>
      <h1>What's on</h1>
      <p className="sch-pub-sub">
        Shows and sounds across We Are Radio, all week. Times in {paris ? "Paris time" : "your time zone"} ({tz.replace(/_/g, " ")}).
      </p>
      {LOCAL_TZ !== "Europe/Paris" && (
        <label className="sch-pub-switch">
          <input type="checkbox" checked={paris} onChange={(e) => setParis(e.target.checked)} />
          <span aria-hidden="true" />
          Show Paris times
        </label>
      )}
    </header>
  );
}

function ChannelDay({ c, slots, nowSec, t, isToday }: { c: GuideChannel; slots: Slot[]; nowSec: number; t: (s: number) => string; isToday: boolean }) {
  const past = isToday ? slots.filter((s) => s.ends_at <= nowSec) : [];
  const rest = isToday ? slots.filter((s) => s.ends_at > nowSec) : slots;
  return (
    <section className="sch-pub-channel" style={{ ["--acc" as string]: c.accent }} aria-labelledby={`sch-pub-ch-${c.slug}`}>
      <h3 id={`sch-pub-ch-${c.slug}`}>
        <i aria-hidden="true" /> {c.name}
        <Link to={`/channel/${c.slug}`} className="sch-pub-ch-listen">
          Listen →
        </Link>
      </h3>
      {past.length > 0 && (
        <details className="sch-pub-earlier">
          <summary>Earlier today ({past.length})</summary>
          <ol className="sch-pub-list">
            {past.map((s) => (
              <Row key={`${s.starts_at}${s.name}`} s={s} nowSec={nowSec} t={t} channel={c} />
            ))}
          </ol>
        </details>
      )}
      <ol className="sch-pub-list">
        {rest.map((s) => (
          <Row key={`${s.starts_at}${s.name}`} s={s} nowSec={nowSec} t={t} channel={c} />
        ))}
      </ol>
    </section>
  );
}

function Row({ s, nowSec, t, channel }: { s: Slot; nowSec: number; t: (s: number) => string; channel: GuideChannel }) {
  const live = s.starts_at <= nowSec && nowSec < s.ends_at;
  const past = s.ends_at <= nowSec;
  return (
    <li className={`sch-pub-row is-${s.kind}${live ? " is-live" : ""}${past ? " is-past" : ""}`}>
      <div className="sch-pub-time">
        <time dateTime={new Date(s.starts_at * 1000).toISOString()}>{t(s.starts_at)}</time>
        <span aria-hidden="true">–</span>
        <time dateTime={new Date(s.ends_at * 1000).toISOString()}>{t(s.ends_at)}</time>
      </div>
      <div className="sch-pub-what">
        <div className="sch-pub-name">
          <strong>{s.name}</strong>
          {live && (
            <span className="sch-pub-live" role="status">
              On now
            </span>
          )}
          {s.recurring && s.kind !== "default" && <span className="sch-pub-rec">↻ {s.recurring}</span>}
        </div>
        {s.description && <p>{s.description}</p>}
        {live && (
          <span className="sch-pub-progress" aria-hidden="true">
            <i style={{ width: `${Math.min(100, ((nowSec - s.starts_at) / (s.ends_at - s.starts_at)) * 100)}%` }} />
          </span>
        )}
      </div>
      {s.kind !== "default" && s.calendar && !past && <AddToCalendar s={s} channel={channel} />}
    </li>
  );
}

function AddToCalendar({ s, channel }: { s: Slot; channel: GuideChannel }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details className="sch-pub-cal" ref={ref}>
      <summary aria-label={`Add ${s.name} to your calendar`}>
        <span aria-hidden="true">＋</span> Add to calendar
      </summary>
      <div className="sch-pub-cal-menu">
        <a href={`${API}${s.calendar!.ics}`} download>
          Apple Calendar
        </a>
        <a href={`${API}${s.calendar!.ics}`} download>
          Outlook (.ics)
        </a>
        {s.calendar!.google && (
          <a href={s.calendar!.google} target="_blank" rel="noopener noreferrer">
            Google Calendar
          </a>
        )}
        <span className="sch-pub-dim">{s.recurring ? `${s.recurring}, on ${channel.name}` : `Once, on ${channel.name}`}</span>
      </div>
    </details>
  );
}

/** Desktop: the day as lanes per channel, read-only. */
function DayGrid({ channels, day, tz, nowSec, t, slotsFor }: { channels: GuideChannel[]; day: string; tz: string; nowSec: number; t: (s: number) => string; slotsFor: (c: GuideChannel) => Slot[] }) {
  // The day's span in the chosen zone: find its midnight by scanning hours (time zones are whole or half hours).
  const start = useMemo(() => {
    const guess = Date.parse(`${day}T00:00:00Z`) / 1000;
    for (let h = -15; h <= 15; h += 0.5) {
      const s = guess - h * 3600;
      if (dateIn(s * 1000, tz) === day && dateIn((s - 1800) * 1000, tz) !== day) return s;
    }
    return guess;
  }, [day, tz]);
  const end = start + 86400;
  const pct = (sec: number) => `${((Math.max(start, Math.min(end, sec)) - start) / 86400) * 100}%`;
  return (
    <div className="sch-pub-grid">
      <div className="sch-pub-grid-axis" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ left: `${(i * 3 * 100) / 24}%` }}>
            {t(start + i * 3 * 3600)}
          </span>
        ))}
      </div>
      {channels.map((c) => (
        <div key={c.slug} className="sch-pub-grid-lane" style={{ ["--acc" as string]: c.accent }}>
          <span className="sch-pub-grid-name">{c.name}</span>
          <div className="sch-pub-grid-track">
            {slotsFor(c).map((s) => (
              <span
                key={`${s.starts_at}${s.name}`}
                className={`sch-pub-grid-bar is-${s.kind}${s.starts_at <= nowSec && nowSec < s.ends_at ? " is-live" : ""}`}
                style={{ left: pct(s.starts_at), width: `calc(${pct(s.ends_at)} - ${pct(s.starts_at)})` }}
                title={`${t(s.starts_at)}–${t(s.ends_at)} ${s.name}`}
              >
                {s.name}
              </span>
            ))}
            {nowSec >= start && nowSec < end && <span className="sch-pub-grid-now" style={{ left: pct(nowSec) }} />}
          </div>
        </div>
      ))}
    </div>
  );
}
