import { occurrencesBetween, type GridBlock, type Occurrence } from "./grid";
import { addDaysTo, parisDate, parisWallClockToUtcMs, weekdayIndex, DAY } from "./time";

/**
 * Release 2 engine checks (dev only, via /dev/scheduler/r2-tests): the
 * recurrence rules of §2.1, the layers of §2.2, and that weekly blocks give
 * exactly Release 1's occurrences (the heart of the deploy-equivalence test,
 * §2.6: the planner only sees occurrences, so the same occurrences means the
 * same log).
 */

// Release 1's occurrence code, verbatim, for comparison.
function legacyOccurrenceOn(block: GridBlock, date: string): Occurrence | null {
  if (!((block.days_mask ?? 0) & (1 << weekdayIndex(date)))) return null;
  const startMs = parisWallClockToUtcMs(date, block.start_min);
  const endMs = block.end_min <= block.start_min ? parisWallClockToUtcMs(addDaysTo(date, 1), block.end_min) : parisWallClockToUtcMs(date, block.end_min);
  if (endMs <= startMs) return null;
  return { block, date, startMs, endMs };
}
function legacyOccurrencesBetween(blocks: GridBlock[], fromMs: number, toMs: number): Occurrence[] {
  const out: Occurrence[] = [];
  let date = addDaysTo(parisDate(fromMs), -1);
  const last = parisDate(toMs + DAY);
  for (let guard = 0; date <= last && guard < 60; guard++, date = addDaysTo(date, 1)) {
    for (const b of blocks) {
      if (!b.active) continue;
      const occ = legacyOccurrenceOn(b, date);
      if (occ && occ.endMs > fromMs && occ.startMs < toMs) out.push(occ);
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < out.length; i++) if (out[i].startMs < out[i - 1].endMs) out[i] = { ...out[i], startMs: out[i - 1].endMs };
  return out.filter((o) => o.endMs > o.startMs);
}

let seq = 0;
function block(p: Partial<GridBlock>): GridBlock {
  return {
    id: `t${++seq}`,
    channel_id: "test",
    name: p.name ?? `Block ${seq}`,
    description: "Test",
    colour: "blue",
    days_mask: 127,
    start_min: 0,
    end_min: 60,
    fill_kind: "autopilot",
    programme_id: null,
    tags_any_json: null,
    active: 1,
    created_at_ms: 0,
    updated_at_ms: 0,
    ...p,
  };
}

const at = (date: string, min: number) => parisWallClockToUtcMs(date, min);
const dates = (occs: Occurrence[]) => occs.map((o) => o.date);
const span = (o: Occurrence) => `${parisDate(o.startMs)} ${new Date(o.startMs).toISOString().slice(11, 16)}Z-${new Date(o.endMs).toISOString().slice(11, 16)}Z`;

export function runR2Tests(): { name: string; ok: boolean; detail?: string }[] {
  const out: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => out.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });

  // ---- §2.6: weekly grids give Release 1's occurrences, around the 25 Oct clock change too.
  const grids: GridBlock[][] = [
    [],
    [block({ days_mask: 0b0010000, start_min: 18 * 60, end_min: 19 * 60 })],
    [block({ days_mask: 127, start_min: 22 * 60, end_min: 2 * 60 })], // past midnight
    [block({ days_mask: 0b1111100, start_min: 6 * 60, end_min: 9 * 60 }), block({ days_mask: 0b1111100, start_min: 9 * 60, end_min: 12 * 60 })],
    [block({ days_mask: 0b1000001, start_min: 1 * 60 + 30, end_min: 3 * 60 + 30 })], // across the clock change hour
    [block({ days_mask: 127, start_min: 0, end_min: 1440 })],
    [block({ days_mask: 0b0101010, start_min: 23 * 60, end_min: 23 * 60 + 45 }), block({ days_mask: 0b1010101, start_min: 12 * 60, end_min: 12 * 60 + 15 })],
  ];
  for (const [i, g] of grids.entries()) {
    for (const start of ["2026-10-09", "2026-10-22", "2027-03-25"]) {
      const from = at(start, 0);
      const to = from + 14 * DAY;
      const a = legacyOccurrencesBetween(g, from, to).map((o) => [o.block.id, o.date, o.startMs, o.endMs].join("|"));
      const b = occurrencesBetween(g, from, to).map((o) => [o.block.id, o.date, o.startMs, o.endMs].join("|"));
      check(`R1 equivalence: grid ${i} from ${start}`, JSON.stringify(a) === JSON.stringify(b), { a: a.slice(0, 4), b: b.slice(0, 4) });
    }
  }

  // ---- §2.1 recurrence.
  const range = (from: string, days: number) => [at(from, 0), at(from, 0) + days * DAY] as const;
  {
    const b = block({ recurrence: "once", once_date: "2026-10-16", days_mask: null, start_min: 20 * 60, end_min: 21 * 60 });
    const [f, t] = range("2026-10-01", 60);
    check("once: one occurrence on its date", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-10-16"]), dates(occurrencesBetween([b], f, t)));
  }
  {
    const b = block({ recurrence: "monthly", monthly_rule: JSON.stringify({ day: 15 }), days_mask: null, start_min: 600, end_min: 660 });
    const [f, t] = range("2026-10-01", 92);
    check("monthly 15th", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-10-15", "2026-11-15", "2026-12-15"]), dates(occurrencesBetween([b], f, t)));
  }
  {
    const b = block({ recurrence: "monthly", monthly_rule: JSON.stringify({ day: 31 }), days_mask: null, start_min: 600, end_min: 660 });
    const [f, t] = range("2026-09-01", 122);
    check("monthly 31st falls back to the last day", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"]), dates(occurrencesBetween([b], f, t)));
  }
  {
    const b = block({ recurrence: "monthly", monthly_rule: JSON.stringify({ nth: 1, weekday: 5 }), days_mask: null, start_min: 600, end_min: 660 });
    const [f, t] = range("2026-10-01", 92);
    check("monthly first Saturday", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-10-03", "2026-11-07", "2026-12-05"]), dates(occurrencesBetween([b], f, t)));
  }
  {
    const b = block({ recurrence: "monthly", monthly_rule: JSON.stringify({ nth: -1, weekday: 4 }), days_mask: null, start_min: 600, end_min: 660 });
    const [f, t] = range("2026-10-01", 92);
    check("monthly last Friday", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-10-30", "2026-11-27", "2026-12-25"]), dates(occurrencesBetween([b], f, t)));
  }
  {
    const b = block({ recurrence: "weekly", days_mask: 127, date_from: "2026-12-01", date_to: "2026-12-24", layer: 2, start_min: 600, end_min: 660, exceptions: ["2026-12-25", "2026-12-10"] });
    const [f, t] = range("2026-11-25", 40);
    const d = dates(occurrencesBetween([b], f, t));
    check("season 1-24 Dec daily, with an exception on 10 Dec", d.length === 23 && d[0] === "2026-12-01" && d[d.length - 1] === "2026-12-24" && !d.includes("2026-12-10"), d);
  }
  {
    const b = block({ days_mask: 0b0010000, exceptions: ["2026-12-25"], start_min: 18 * 60, end_min: 19 * 60 });
    const [f, t] = range("2026-12-14", 21);
    check("every Friday except 25 December", JSON.stringify(dates(occurrencesBetween([b], f, t))) === JSON.stringify(["2026-12-18", "2027-01-01"]), dates(occurrencesBetween([b], f, t)));
  }

  // ---- §2.2 layers: a one-off 20:00-21:00 on top of a recurring 18:00-22:00.
  {
    const rec = block({ name: "Recurring", days_mask: 0b0010000, start_min: 18 * 60, end_min: 22 * 60, layer: 1 });
    const special = block({ name: "Special", recurrence: "once", once_date: "2026-10-16", days_mask: null, start_min: 20 * 60, end_min: 21 * 60, layer: 3 });
    const occs = occurrencesBetween([rec, special], at("2026-10-16", 0), at("2026-10-17", 0));
    const want = [
      ["Recurring", at("2026-10-16", 18 * 60), at("2026-10-16", 20 * 60), at("2026-10-16", 18 * 60), true],
      ["Special", at("2026-10-16", 20 * 60), at("2026-10-16", 21 * 60), at("2026-10-16", 20 * 60), false],
      ["Recurring", at("2026-10-16", 21 * 60), at("2026-10-16", 22 * 60), at("2026-10-16", 18 * 60), false],
    ];
    const got = occs.map((o) => [o.block.name, o.startMs, o.endMs, o.originMs, !!o.cut]);
    check("layers: recurring 18-20, the special 20-21, recurring resumes 21-22 laid out from 18:00", JSON.stringify(got) === JSON.stringify(want), got.map((g) => g.join(" ")));
  }
  {
    // Same layer: the earlier-starting one wins (as Release 1); validation will call it a conflict.
    const a = block({ name: "A", days_mask: 127, start_min: 18 * 60, end_min: 19 * 60 });
    const b = block({ name: "B", days_mask: 127, start_min: 18 * 60 + 30, end_min: 19 * 60 + 30 });
    const occs = occurrencesBetween([a, b], at("2026-10-16", 0), at("2026-10-17", 0));
    check("same layer: B starts when A ends", occs.length === 2 && occs[1].startMs === occs[0].endMs, occs.map(span));
  }
  return out;
}
