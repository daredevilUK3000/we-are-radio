import { blockLengthMin, blockTags, type GridBlock } from "./grid";
import { describeRule, parseRule, SlotResolver, type ListSlot, type PlanContent, type SnapshotList, type SnapshotRunningOrder } from "./content";
import { MINUTE, mmss } from "./time";

/**
 * Lengths of hand-planned content, before anything is built: what each slot
 * will probably take, whether it can play at all, and how the whole compares
 * with the block. Used by validation (§2.5), the running-order editor's
 * duration bar (§6.2) and the playlists page's totals (§7).
 */

export interface SlotEstimate {
  position: number;
  slot_kind: ListSlot["slot_kind"];
  /** What it's called on screen: the song or item title, or the slot's own label. */
  label: string;
  /** The slot's own label as saved ("Opening jingle", "Interview"). */
  slot_label: string | null;
  /** Real length for a fixed item; the average of what a rule could pick ("about"); null when it can't play. */
  ms: number | null;
  /** A fixed slot whose audio is missing or unpublished. */
  missing: boolean;
  /** An episode slot still waiting for content. */
  empty: boolean;
  /** A rule nothing matches. */
  no_match: boolean;
  at_ms: number | null;
  auto_filled: boolean;
  item_type: string | null;
  track_id: string | null;
  audio_asset_id: string | null;
}

export async function estimateSlots(resolver: SlotResolver, slots: ListSlot[]): Promise<SlotEstimate[]> {
  const out: SlotEstimate[] = [];
  for (const s of slots) {
    const base = {
      position: s.position, slot_kind: s.slot_kind, slot_label: s.label ?? null, at_ms: s.at_ms ?? null, auto_filled: !!s.auto_filled,
      track_id: s.track_id, audio_asset_id: s.audio_asset_id, missing: false, empty: false, no_match: false,
    };
    if (s.slot_kind === "fixed") {
      const p = await resolver.fixed(s);
      out.push({ ...base, label: p?.label ?? s.label ?? "An item", ms: p ? p.fileMs : null, missing: !p, item_type: p?.itemType ?? null });
    } else if (s.slot_kind === "rule") {
      const rule = parseRule(s.rule_json);
      const cands = rule ? await resolver.candidates(rule) : [];
      const avg = cands.length ? Math.round(cands.reduce((a, p) => a + p.fileMs, 0) / cands.length) : null;
      out.push({ ...base, label: s.label || `Rule: ${describeRule(rule)}`, ms: avg, no_match: cands.length === 0, item_type: rule?.item_type ?? null });
    } else {
      out.push({ ...base, label: s.label || "Episode slot", ms: null, empty: true, item_type: null });
    }
  }
  return out;
}

export const sumMs = (est: SlotEstimate[], fixedOnly = false) =>
  est.reduce((a, e) => a + (e.ms !== null && (!fixedOnly || (e.slot_kind === "fixed" && !e.auto_filled)) ? e.ms : 0), 0);

/** What an occurrence plays: its running order, else its template or playlist (mirrors Planner.handEntries). */
export function occurrenceSource(b: GridBlock, date: string, content: PlanContent): { ro: SnapshotRunningOrder | null; list: SnapshotList | null; slots: ListSlot[] } {
  const ro = content.running_orders.find((r) => r.block_id === b.id && r.date === date) ?? null;
  const list = b.list_id ? (content.lists[b.list_id] ?? null) : null;
  if ((b.fill_kind === "template" || b.fill_kind === "manual") && ro) return { ro, list, slots: ro.items };
  if (b.fill_kind === "manual" || !list) return { ro: null, list, slots: [] };
  return { ro: null, list, slots: list.slots };
}

export const resolverForBlock = (db: D1Database, b: GridBlock, channelTags: string[]) => {
  const tags = blockTags(b);
  return new SlotResolver(db, tags.length ? tags : channelTags);
};

export interface AnchorProblem {
  at_ms: number;
  before_ms: number;
}

/**
 * Fixed content that can't reach an internal anchor: the fixed items
 * between the previous anchor (or the block start) and this one run longer
 * than the time between them.
 */
export function anchorProblems(est: SlotEstimate[]): AnchorProblem[] {
  const out: AnchorProblem[] = [];
  let segStart = 0;
  let fixed = 0;
  for (const e of est) {
    if (e.at_ms !== null) {
      if (segStart + fixed > e.at_ms) out.push({ at_ms: e.at_ms, before_ms: fixed });
      segStart = e.at_ms;
      fixed = 0;
    }
    if (e.slot_kind === "fixed" && !e.auto_filled && e.ms !== null) fixed += e.ms;
  }
  return out;
}

/**
 * Start times through a running order, as the editor shows them: each item
 * after the one before, or at its own `at` time.
 */
export function startTimes(est: SlotEstimate[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const e of est) {
    if (e.at_ms !== null && e.at_ms > t) t = e.at_ms;
    out.push(t);
    t += e.empty ? 0 : (e.ms ?? 0);
  }
  return out;
}

/** "52:37 of 1:00:00" style lengths. */
export function hms(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  return h ? `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : mmss(ms);
}

export const blockLengthMs = (b: Pick<GridBlock, "start_min" | "end_min">) => blockLengthMin(b) * MINUTE;
