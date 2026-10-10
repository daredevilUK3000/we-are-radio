import { STATION_TZ } from "../capsules";

/**
 * Clock helpers for the Scheduler. Everything is Unix milliseconds; the
 * conversions to and from wall-clock time live here, with no date library.
 *
 * Two calendars matter:
 * - the weekly grid runs on Europe/Paris wall-clock time (the studio's);
 * - time capsules air on their date in STATION_TZ (Europe/London, see
 *   capsules.ts), so the channel default's loop can only change at London
 *   midnight. Reproducing today's playback exactly depends on keeping that.
 */

export const PARIS_TZ = "Europe/Paris";
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface WallClock {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since that date's midnight
  seconds: number;
}

export function wallClock(ms: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    seconds: Number(get("second")),
  };
}

/** The zone's offset from UTC at an instant, in ms (Paris: +1 h in winter, +2 h in summer). */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const asUtc = Date.parse(`${w.date}T00:00:00Z`) + w.minutes * MINUTE + w.seconds * 1000;
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a zone. `minutes` may be 1440 (the
 * next midnight). On the autumn night the repeated hour resolves to its first
 * occurrence; in spring a time inside the missing hour resolves to the moment
 * the clocks jump (so 02:30 becomes 03:00).
 */
export function wallClockToUtcMs(date: string, minutes: number, timeZone: string): number {
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE;
  // Try the offsets in force a few hours either side; keep the first that round-trips.
  const candidates = [offsetAt(naive - 3 * HOUR, timeZone), offsetAt(naive + 3 * HOUR, timeZone)].sort((a, b) => b - a);
  for (const off of candidates) {
    const ms = naive - off;
    const back = wallClock(ms, timeZone);
    if (Date.parse(`${back.date}T00:00:00Z`) + back.minutes * MINUTE === naive) return ms;
  }
  // Not a real wall-clock time (spring gap): the moment the clock jumps past it.
  return naive - Math.min(...candidates);
}

export const parisWallClockToUtcMs = (date: string, minutes: number) => wallClockToUtcMs(date, minutes, PARIS_TZ);
export const parisDate = (ms: number) => wallClock(ms, PARIS_TZ).date;
/** London (STATION_TZ) date: the capsule calendar. */
export const stationDate = (ms: number) => wallClock(ms, STATION_TZ).date;
export const stationDayStartMs = (date: string) => wallClockToUtcMs(date, 0, STATION_TZ);

export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday (the grid's days_mask bit order). */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 16 Oct" for a Paris date. */
export const shortDay = (date: string) => `${WEEKDAY_SHORT[weekdayIndex(date)]} ${Number(date.slice(8, 10))} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]}`;

export const hhmm = (minutes: number) =>
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "16:00" in Paris time for an instant. */
export const parisHHMM = (ms: number) => hhmm(wallClock(ms, PARIS_TZ).minutes);

/** "Tue 07:00" in Paris time. */
export function parisDayTime(ms: number): string {
  const w = wallClock(ms, PARIS_TZ);
  return `${WEEKDAY_SHORT[weekdayIndex(w.date)]} ${hhmm(w.minutes)}`;
}

/** "2:10" / "-0:45" for a length in ms. */
export function mmss(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const s = Math.round(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
