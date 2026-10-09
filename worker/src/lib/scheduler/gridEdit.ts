import type { Channel } from "../types";
import { blockFillProblem } from "./health";
import { blockLengthMin, type GridBlock } from "./grid";
import { hhmm, WEEKDAY_SHORT } from "./time";

/**
 * Validating a grid block before it's saved: no overlap with another active
 * block on the same channel and day, at least 15 minutes, 15-minute steps, a
 * published non-empty programme, and (a warning only) an autopilot pool big
 * enough not to repeat a song within two hours.
 */

export interface BlockInput {
  name: string;
  description: string;
  days_mask: number;
  start_min: number;
  end_min: number;
  fill_kind: "programme" | "autopilot";
  programme_id: string | null;
  tags_any: string[];
  colour: GridBlock["colour"];
  active: boolean;
}

export function parseBlockInput(body: Record<string, unknown>): { ok: true; value: BlockInput } | { ok: false; field: string; message: string } {
  const bad = (field: string, message: string) => ({ ok: false as const, field, message });
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const description = String(body.description ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  const days = Number(body.days_mask);
  const start = Number(body.start_min);
  const end = Number(body.end_min);
  const fill = body.fill_kind === "programme" ? "programme" : body.fill_kind === "autopilot" ? "autopilot" : null;
  const colour = ["blue", "purple", "gold", "green"].includes(String(body.colour)) ? (String(body.colour) as GridBlock["colour"]) : "blue";
  if (!name) return bad("name", "Give the block a name.");
  if (!description) return bad("description", "Describe the sound of this block in one line: it's what tells you what should be playing.");
  if (!Number.isInteger(days) || days < 1 || days > 127) return bad("days_mask", "Choose at least one day.");
  if (!Number.isInteger(start) || start < 0 || start > 1425 || start % 15) return bad("start_min", "Start times go in 15-minute steps.");
  if (!Number.isInteger(end) || end < 15 || end > 1440 || end % 15) return bad("end_min", "End times go in 15-minute steps.");
  if (end === start) return bad("end_min", "The block needs a length.");
  if (blockLengthMin({ start_min: start, end_min: end }) < 15) return bad("end_min", "Blocks are at least 15 minutes long.");
  if (!fill) return bad("fill_kind", "Choose what fills the block.");
  const tags = Array.isArray(body.tags_any) ? body.tags_any.map(String).filter(Boolean).slice(0, 20) : [];
  const programme = fill === "programme" ? String(body.programme_id ?? "") || null : null;
  if (fill === "programme" && !programme) return bad("programme_id", "Choose a programme.");
  return {
    ok: true,
    value: { name, description, days_mask: days, start_min: start, end_min: end, fill_kind: fill, programme_id: programme, tags_any: tags, colour, active: body.active !== false },
  };
}

/** Minutes-of-week intervals a block covers (a block past Sunday midnight wraps to Monday). */
function weekIntervals(b: Pick<GridBlock, "days_mask" | "start_min" | "end_min">): [number, number][] {
  const out: [number, number][] = [];
  const len = blockLengthMin(b);
  for (let d = 0; d < 7; d++) {
    if (!((b.days_mask ?? 0) & (1 << d))) continue;
    const s = d * 1440 + b.start_min;
    const e = s + len;
    if (e <= 10080) out.push([s, e]);
    else {
      out.push([s, 10080]);
      out.push([0, e - 10080]);
    }
  }
  return out;
}

export function overlapWith(input: Pick<GridBlock, "days_mask" | "start_min" | "end_min">, others: GridBlock[]): GridBlock | null {
  const mine = weekIntervals(input);
  for (const o of others) {
    if (!o.active) continue;
    for (const [a, b] of weekIntervals(o)) for (const [c, d] of mine) if (a < d && c < b) return o;
  }
  return null;
}

export async function validateBlock(
  db: D1Database,
  channel: Channel,
  input: BlockInput,
  others: GridBlock[]
): Promise<{ errors: { field: string; message: string }[]; warnings: string[] }> {
  const errors: { field: string; message: string }[] = [];
  const warnings: string[] = [];
  if (input.active) {
    const clash = overlapWith(input, others);
    if (clash) {
      const days = WEEKDAY_SHORT.filter((_, i) => (clash.days_mask ?? 0) & input.days_mask & (1 << i)).join(", ");
      errors.push({ field: "start_min", message: `Overlaps ${clash.name} (${hhmm(clash.start_min)}–${hhmm(clash.end_min)}${days ? `, ${days}` : ""}).` });
    }
  }
  const problem = await blockFillProblem(db, channel, { ...input, tags_any_json: JSON.stringify(input.tags_any) });
  if (problem?.level === "red") errors.push({ field: input.fill_kind === "programme" ? "programme_id" : "tags_any", message: `Can't fill it: ${problem.text}.` });
  else if (problem?.level === "amber") warnings.push(`Songs may repeat: ${problem.text}.`);
  return { errors, warnings };
}
