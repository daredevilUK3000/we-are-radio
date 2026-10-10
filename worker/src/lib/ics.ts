import type { Channel } from "./types";
import { blockRunsOn, runsPastMidnight, type GridBlock } from "./scheduler/grid";
import { addDaysTo, parisDate, parisWallClockToUtcMs } from "./scheduler/time";

/**
 * "Add to calendar" for a public block (handoff §11.1): an iCalendar file in
 * Paris time with the block's repeat rule, its season end and its skipped
 * dates, and the same rule for a Google Calendar link.
 */

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const pad = (n: number) => String(n).padStart(2, "0");
const local = (date: string, min: number) => `${date.replace(/-/g, "")}T${pad(Math.floor(min / 60) % 24)}${pad(min % 60)}00`;
const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The first date (from `from`, Paris) the block airs, ignoring nothing - within a year and a bit. */
export function firstAiring(block: GridBlock, from: string): string | null {
  let d = block.date_from && block.date_from > from ? block.date_from : from;
  for (let i = 0; i < 400; i++, d = addDaysTo(d, 1)) if (blockRunsOn(block, d)) return d;
  return null;
}

/** RRULE body for a repeating block (no "RRULE:" prefix), or null for a one-off. */
export function rruleFor(block: GridBlock): string | null {
  const rec = block.recurrence ?? "weekly";
  if (rec === "once") return null;
  const parts: string[] = [];
  if (rec === "weekly") {
    parts.push("FREQ=WEEKLY", `BYDAY=${BYDAY.filter((_, i) => (block.days_mask ?? 0) & (1 << i)).join(",")}`);
  } else {
    let rule: { day?: number; nth?: number; weekday?: number } = {};
    try {
      rule = JSON.parse(block.monthly_rule ?? "{}");
    } catch {
      /* empty */
    }
    parts.push("FREQ=MONTHLY");
    if (typeof rule.day === "number") {
      // "The 31st, or the last day of a shorter month": the last of 28..31 that exists.
      if (rule.day > 28) parts.push(`BYMONTHDAY=${Array.from({ length: rule.day - 27 }, (_, i) => 28 + i).join(",")}`, "BYSETPOS=-1");
      else parts.push(`BYMONTHDAY=${rule.day}`);
    } else if (typeof rule.nth === "number" && typeof rule.weekday === "number") parts.push(`BYDAY=${rule.nth}${BYDAY[rule.weekday]}`);
  }
  if (block.date_to) {
    // UNTIL is in UTC when DTSTART has a time zone: the end of the season's last day in Paris.
    parts.push(`UNTIL=${utcStamp(parisWallClockToUtcMs(addDaysTo(block.date_to, 1), 0) - 1000)}`);
  }
  return parts.join(";");
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curBytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const PARIS_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function icsForBlock(block: GridBlock, channel: Channel, nowMs = Date.now()): string | null {
  const date = firstAiring(block, parisDate(nowMs));
  if (!date) return null;
  const endDate = runsPastMidnight(block) || block.end_min === 1440 ? addDaysTo(date, 1) : date;
  const endMin = block.end_min === 1440 ? 0 : block.end_min;
  const listen = `https://weareradio.app/channel/${channel.slug}`;
  const rrule = rruleFor(block);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//We Are Radio//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`${block.name} on We Are Radio`)}`,
    ...PARIS_VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${block.id}@weareradio.app`,
    `DTSTAMP:${utcStamp(nowMs)}`,
    `DTSTART;TZID=Europe/Paris:${local(date, block.start_min)}`,
    `DTEND;TZID=Europe/Paris:${local(endDate, endMin)}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    ...(rrule ? (block.exceptions ?? []).filter((d) => d >= date).map((d) => `EXDATE;TZID=Europe/Paris:${local(d, block.start_min)}`) : []),
    `SUMMARY:${esc(`${block.name} on We Are Radio`)}`,
    `DESCRIPTION:${esc(`${block.description}\nListen: ${listen}`)}`,
    `URL:${listen}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A prefilled Google Calendar link for the block's first airing, repeating as it does. */
export function googleCalendarUrl(block: GridBlock, channel: Channel, nowMs = Date.now()): string | null {
  const date = firstAiring(block, parisDate(nowMs));
  if (!date) return null;
  const endDate = runsPastMidnight(block) || block.end_min === 1440 ? addDaysTo(date, 1) : date;
  const endMin = block.end_min === 1440 ? 0 : block.end_min;
  const listen = `https://weareradio.app/channel/${channel.slug}`;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${block.name} on We Are Radio`,
    dates: `${local(date, block.start_min)}/${local(endDate, endMin)}`,
    ctz: "Europe/Paris",
    details: `${block.description}\nListen: ${listen}`,
    location: listen,
  });
  const rrule = rruleFor(block);
  if (rrule) q.set("recur", `RRULE:${rrule}`);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
