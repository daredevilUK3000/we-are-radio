import { newId } from "../id";
import { blockLengthMin, type BlockColour, type GridBlock } from "./grid";

/**
 * Release 2 block input (handoff §1.2, §4.1): what the Timeline's editor
 * sends, checked for shape only. Overlaps are allowed in the working copy:
 * they become `conflict` issues (validate.ts), not save errors.
 *
 * A block is filled by autopilot tags, a programme, a playlist, a template
 * (with per-date episodes), or by hand (a manual running order per date).
 */

const COLOURS: BlockColour[] = ["blue", "purple", "gold", "green", "red", "grey"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: unknown): d is string => typeof d === "string" && DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

export type BlockFields = Omit<GridBlock, "id" | "channel_id" | "created_at_ms" | "updated_at_ms">;

export function parsePlanBlock(body: Record<string, unknown>): { ok: true; value: BlockFields } | { ok: false; field: string; message: string } {
  const bad = (field: string, message: string) => ({ ok: false as const, field, message });
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const description = String(body.description ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!name) return bad("name", "Give the block a name.");
  if (!description) return bad("description", "Describe the sound of this block in one line: it's what listeners see on the schedule.");

  const recurrence = body.recurrence === "once" || body.recurrence === "monthly" ? body.recurrence : "weekly";
  let days_mask: number | null = null;
  let once_date: string | null = null;
  let monthly_rule: string | null = null;
  if (recurrence === "weekly") {
    days_mask = Number(body.days_mask);
    if (!Number.isInteger(days_mask) || days_mask < 1 || days_mask > 127) return bad("days_mask", "Choose at least one day.");
  } else if (recurrence === "once") {
    if (!validDate(body.once_date)) return bad("once_date", "Choose the date.");
    once_date = body.once_date;
  } else {
    const r = (typeof body.monthly_rule === "string" ? safeJson(body.monthly_rule) : body.monthly_rule) as { day?: unknown; nth?: unknown; weekday?: unknown } | null;
    if (r && Number.isInteger(r.day) && Number(r.day) >= 1 && Number(r.day) <= 31) monthly_rule = JSON.stringify({ day: Number(r.day) });
    else if (r && [1, 2, 3, 4, -1].includes(Number(r.nth)) && Number.isInteger(r.weekday) && Number(r.weekday) >= 0 && Number(r.weekday) <= 6)
      monthly_rule = JSON.stringify({ nth: Number(r.nth), weekday: Number(r.weekday) });
    else return bad("monthly_rule", "Choose which day of the month.");
  }

  const date_from = body.date_from ? (validDate(body.date_from) ? body.date_from : null) : null;
  const date_to = body.date_to ? (validDate(body.date_to) ? body.date_to : null) : null;
  if (body.date_from && !date_from) return bad("date_from", "That season start isn't a date.");
  if (body.date_to && !date_to) return bad("date_to", "That season end isn't a date.");
  if (date_from && date_to && date_to < date_from) return bad("date_to", "The season ends before it starts.");

  const start = Number(body.start_min);
  const end = Number(body.end_min);
  if (!Number.isInteger(start) || start < 0 || start > 1435 || start % 5) return bad("start_min", "Start times go in 5-minute steps.");
  if (!Number.isInteger(end) || end < 5 || end > 1440 || end % 5) return bad("end_min", "End times go in 5-minute steps.");
  if (end === start || blockLengthMin({ start_min: start, end_min: end }) < 5) return bad("end_min", "The block needs a length.");

  const FILLS = ["programme", "autopilot", "playlist", "template", "manual"] as const;
  const fill = FILLS.find((f) => f === body.fill_kind) ?? null;
  if (!fill) return bad("fill_kind", "Choose what fills the block.");
  const programme_id = fill === "programme" ? String(body.programme_id ?? "") || null : null;
  if (fill === "programme" && !programme_id) return bad("programme_id", "Choose a programme.");
  // A template fills template blocks only, a playlist playlist blocks only (§7); checked against the list itself by the route.
  const list_id = fill === "playlist" || fill === "template" ? String(body.list_id ?? "") || null : null;
  if ((fill === "playlist" || fill === "template") && !list_id) return bad("list_id", `Choose a ${fill}.`);
  const tags = Array.isArray(body.tags_any) ? body.tags_any.map(String).filter(Boolean).slice(0, 20) : [];

  // The layer follows from the repeat unless it's set: one-offs on top, then seasons, then the regular week.
  const layerIn = Number(body.layer);
  const layer = [1, 2, 3].includes(layerIn) ? layerIn : recurrence === "once" ? 3 : date_from || date_to ? 2 : 1;
  const exceptions = Array.isArray(body.exceptions) ? [...new Set(body.exceptions.filter(validDate))].sort().slice(0, 200) : [];

  return {
    ok: true,
    value: {
      name,
      description,
      colour: COLOURS.includes(body.colour as BlockColour) ? (body.colour as BlockColour) : "blue",
      recurrence,
      days_mask,
      once_date,
      monthly_rule,
      date_from,
      date_to,
      start_min: start,
      end_min: end,
      layer,
      start_mode: body.start_mode === "flexible" ? "flexible" : "hard",
      end_mode: body.end_mode === "flexible" ? "flexible" : "hard",
      priority: body.priority === "high" ? "high" : "normal",
      // Manual blocks are built item by item; everything else fills itself.
      mode: fill === "manual" ? "manual" : "auto",
      fill_kind: fill,
      programme_id,
      list_id,
      tags_any_json: JSON.stringify(tags),
      when_short: body.when_short === "loop" ? "loop" : "fill",
      public: body.public === false || body.public === 0 ? 0 : 1,
      active: body.active === false || body.active === 0 ? 0 : 1,
      exceptions,
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const BLOCK_SQL_COLUMNS = [
  "id", "channel_id", "name", "description", "colour", "recurrence", "days_mask", "once_date", "monthly_rule", "date_from", "date_to",
  "start_min", "end_min", "layer", "start_mode", "end_mode", "priority", "mode", "fill_kind", "programme_id", "list_id", "tags_any_json",
  "when_short", "public", "active", "created_at_ms", "updated_at_ms",
] as const;

/** Statements writing one block and its exceptions to the working copy (insert or replace). */
export function writeBlockStatements(db: D1Database, b: GridBlock): D1PreparedStatement[] {
  const row = b as unknown as Record<string, unknown>;
  const defaults: Record<string, unknown> = {
    recurrence: "weekly", layer: 1, start_mode: "hard", end_mode: "hard", priority: "normal", mode: "auto", when_short: "fill", public: 1,
    once_date: null, monthly_rule: null, date_from: null, date_to: null, list_id: null,
  };
  const values = BLOCK_SQL_COLUMNS.map((c) => (row[c] === undefined ? (defaults[c] ?? null) : row[c]));
  return [
    db
      .prepare(
        `INSERT INTO sched_blocks (${BLOCK_SQL_COLUMNS.join(",")}) VALUES (${BLOCK_SQL_COLUMNS.map(() => "?").join(",")})
         ON CONFLICT(id) DO UPDATE SET ${BLOCK_SQL_COLUMNS.filter((c) => c !== "id" && c !== "created_at_ms").map((c) => `${c} = excluded.${c}`).join(", ")}`
      )
      .bind(...values),
    db.prepare("DELETE FROM sched_block_exceptions WHERE block_id = ?").bind(b.id),
    ...(b.exceptions ?? []).map((d) => db.prepare("INSERT OR IGNORE INTO sched_block_exceptions (block_id, date) VALUES (?, ?)").bind(b.id, d)),
  ];
}

export const newBlockId = () => newId("blk");
