import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { HintBar, Icon, OnAirPill, TvButton, TvClock } from "../components";
import { useTvPlayer } from "../TvPlayer";
import { clockText, stillFor, useGuide, useNow, type GuideChannel, type GuideSlot } from "../tvData";

/** Screen 3: What's on (handoff_tv_firetv.md §A6). Times in the TV's own zone. */

const HOUR = 3600_000;
const WINDOW_HOURS = 4;
const PX_PER_HOUR = 352;
const HALF_HOUR = HOUR / 2;

const startOfLocalDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** The opening window: today from the current half hour minus 30 minutes; other days from 18:00. */
function windowFor(dayIndex: number, nowMs: number): number {
  if (dayIndex === 0) return Math.floor(nowMs / HALF_HOUR) * HALF_HOUR - HALF_HOUR;
  const d = new Date(startOfLocalDay(nowMs));
  d.setDate(d.getDate() + dayIndex);
  d.setHours(18, 0, 0, 0);
  return d.getTime();
}

function dayLabel(index: number, nowMs: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const d = new Date(startOfLocalDay(nowMs));
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

/** "19:00–21:00", or "All day" for a channel's whole-day default span. */
const rangeText = (s: GuideSlot) => (s.ends_at - s.starts_at >= 23 * 3600 ? "All day" : `${clockText(s.starts_at * 1000)}–${clockText(s.ends_at * 1000)}`);

const slotAt = (lane: GuideChannel | undefined, t: number) =>
  lane?.slots.find((s) => s.starts_at * 1000 <= t && t < s.ends_at * 1000) ?? null;

function relDay(ms: number, nowMs: number): string {
  const diff = Math.round((startOfLocalDay(ms) - startOfLocalDay(nowMs)) / (24 * HOUR));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function Schedule() {
  const navigate = useNavigate();
  const player = useTvPlayer();
  const guide = useGuide(7);
  const nowMs = useNow(15_000);
  const [day, setDay] = useState(0);
  const [winStart, setWinStart] = useState(() => windowFor(0, Date.now()));
  const [lane, setLane] = useState(0);
  const [cursor, setCursor] = useState(() => Date.now());
  const { ref, focusKey } = useFocusable({ focusKey: "tv-schedule", trackChildren: true });

  const lanes = guide ?? [];
  const winEnd = winStart + WINDOW_HOURS * HOUR;

  useEffect(() => {
    const t = window.setTimeout(() => setFocus("tv-grid"), 80);
    return () => window.clearTimeout(t);
  }, [guide]);

  // Keep the lane in range, and the cursor focused on the playing channel at first.
  useEffect(() => {
    if (!guide) return;
    const i = guide.findIndex((g) => g.slug === player.slug);
    if (i >= 0) setLane(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide]);

  const current = slotAt(lanes[lane], cursor) ?? lanes[lane]?.slots.find((s) => s.ends_at * 1000 > winStart) ?? null;

  const pickDay = (i: number) => {
    setDay(i);
    const w = windowFor(i, Date.now());
    setWinStart(w);
    setCursor(Math.max(w, i === 0 ? Date.now() : w));
    setFocus("tv-grid");
  };

  const onGridArrow = (dir: string): boolean => {
    const l = lanes[lane];
    if (!l) return true;
    const cur = slotAt(l, cursor);
    if (dir === "up") {
      if (lane === 0) {
        // On to the day tabs (the selected one). Their container spans the
        // whole screen, so the library can't find it "above" by geometry.
        setFocus(`tv-day-${day}`);
        return false;
      }
      setLane(lane - 1);
      return false;
    }
    if (dir === "down") {
      if (lane < lanes.length - 1) setLane(lane + 1);
      return false;
    }
    if (dir === "right") {
      const next = l.slots.find((s) => s.starts_at * 1000 >= (cur ? cur.ends_at * 1000 : cursor + 1));
      if (!next || next.starts_at * 1000 >= winEnd) {
        // Past the window's edge: scroll time by an hour.
        setWinStart(winStart + HOUR);
        setCursor(Math.max(cursor, winStart + HOUR));
      } else setCursor(next.starts_at * 1000);
      return false;
    }
    if (dir === "left") {
      const prev = [...l.slots].reverse().find((s) => s.ends_at * 1000 <= (cur ? cur.starts_at * 1000 : cursor));
      if (!prev || prev.ends_at * 1000 <= winStart) {
        setWinStart(winStart - HOUR);
        setCursor(Math.min(cursor, winStart - HOUR + WINDOW_HOURS * HOUR - 1));
      } else setCursor(Math.max(prev.starts_at * 1000, winStart));
      return false;
    }
    return true;
  };

  const onGridEnter = () => {
    const l = lanes[lane];
    const s = slotAt(l, cursor);
    const t = Date.now();
    // Only a programme on now plays; later ones do nothing on TV in v1.
    if (l && s && s.starts_at * 1000 <= t && t < s.ends_at * 1000) {
      player.tune(l.slug, { play: true });
      navigate(`/tv/listen/${l.slug}`);
    }
  };

  const grid = useFocusable({ focusKey: "tv-grid", onArrowPress: (dir) => onGridArrow(dir), onEnterPress: onGridEnter });
  const gridFocused = grid.focused;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => i), []);
  const onNow = current && current.starts_at * 1000 <= nowMs && nowMs < current.ends_at * 1000;
  const laneInfo = lanes[lane];

  const ruler: number[] = [];
  for (let t = winStart; t <= winEnd; t += HALF_HOUR) ruler.push(t);
  const xOf = (t: number) => ((t - winStart) / HOUR) * PX_PER_HOUR;

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="tv-screen tv-sched">
        {laneInfo && <img className="tv-sched-bg" src={stillFor(laneInfo.slug)} alt="" />}
        <header className="tv-top tv-sched-top">
          <TvButton focusKey="tv-sched-back" className="tv-circle" onPress={() => navigate("/tv")}>
            {Icon.back}
          </TvButton>
          <h1 className="tv-sched-title">What's on</h1>
          <div className="tv-tabs" role="tablist">
            {days.map((i) => (
              <TvButton key={i} focusKey={`tv-day-${i}`} className={`tv-tab${day === i ? " is-selected" : ""}`} onPress={() => pickDay(i)}>
                {dayLabel(i, nowMs)}
              </TvButton>
            ))}
          </div>
          <TvClock />
        </header>

        <section className="tv-sched-detail" aria-live="polite">
          {current && laneInfo ? (
            <>
              <div className="tv-sched-eyebrow">
                {onNow && <OnAirPill />}
                <span>
                  {laneInfo.name} · {relDay(current.starts_at * 1000, nowMs)} · {rangeText(current)}
                </span>
              </div>
              <h2 className="tv-sched-name">{current.name}</h2>
              {current.description && <p className="tv-sched-desc">{current.description}</p>}
              <div className="tv-sched-action">
                {onNow ? (
                  <span className="tv-pill is-primary is-static">{Icon.play} Listen now</span>
                ) : (
                  <>
                    <span className="tv-chip">
                      {Icon.clock} Starts at {clockText(current.starts_at * 1000)}
                    </span>
                    <span className="tv-pill is-static">
                      {Icon.play} Listen to {laneInfo.name}
                    </span>
                  </>
                )}
              </div>
            </>
          ) : (
            <h2 className="tv-sched-name">{guide ? "The schedule is coming soon" : "Loading the schedule…"}</h2>
          )}
        </section>

        <div ref={grid.ref} className={`tv-grid${gridFocused ? " is-focused" : ""}`}>
          <div className="tv-ruler" style={{ marginLeft: 296 }}>
            {/* A time under the red "now" tag is hidden rather than drawn half-covered. */}
            {ruler.filter((t) => Math.abs(xOf(t) - xOf(nowMs)) > 60 || nowMs < winStart || nowMs > winEnd).map((t) => (
              <span key={t} style={{ left: xOf(t) }}>
                {clockText(t)}
              </span>
            ))}
          </div>
          {lanes.map((g, li) => (
            <div key={g.slug} className={`tv-lane${li === lane ? " is-current" : ""}`}>
              <div className="tv-lane-label">
                <img src={stillFor(g.slug)} alt="" />
                <span>{g.name}</span>
              </div>
              <div className="tv-lane-track">
                {nowMs > winStart && <div className="tv-past" style={{ width: Math.min(xOf(nowMs), WINDOW_HOURS * PX_PER_HOUR) }} />}
                {g.slots
                  .filter((s) => s.ends_at * 1000 > winStart && s.starts_at * 1000 < winEnd)
                  .map((s: GuideSlot) => {
                    const a = Math.max(s.starts_at * 1000, winStart);
                    const b = Math.min(s.ends_at * 1000, winEnd);
                    const isCursor = gridFocused && li === lane && current === s;
                    return (
                      <div
                        key={`${s.starts_at}-${s.name}`}
                        className={`tv-slot is-${s.kind}${isCursor ? " is-focused" : ""}`}
                        style={{ left: xOf(a) + 3, width: Math.max(8, xOf(b) - xOf(a) - 6) }}
                      >
                        <span className="tv-slot-name">
                          {s.starts_at * 1000 < winStart ? "‹ " : ""}
                          {s.name}
                          {s.ends_at * 1000 > winEnd ? " ›" : ""}
                        </span>
                        <span className="tv-slot-time">{rangeText(s)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          {nowMs >= winStart && nowMs <= winEnd && (
            <div className="tv-nowline" style={{ left: 296 + xOf(nowMs) }}>
              <span>{clockText(nowMs)}</span>
            </div>
          )}
        </div>

        <HintBar
          items={[
            ["◀ ▶", "Earlier and later"],
            ["OK", "Listen"],
          ]}
        />
      </div>
    </FocusContext.Provider>
  );
}
