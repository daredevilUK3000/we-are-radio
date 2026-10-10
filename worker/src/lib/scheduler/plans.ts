import { newId } from "../id";
import { loadWorkingBlocks, type GridBlock } from "./grid";
import { workingContent, type PlanContent, type SnapshotList, type SnapshotRunningOrder } from "./content";

/**
 * Published plans (handoff_scheduler_release2.md §1.1, §1.5, §1.6): immutable
 * snapshots of everything one channel's log is built from. The generator
 * only ever reads the latest one per channel; Patrick's edits go to the
 * working copy (sched_blocks and friends) and reach the air only when a new
 * snapshot is published.
 *
 * A channel without a plan gets plan #1 lazily, from its working copy as it
 * stands ("Release 2: the weekly grid as it was"). Seeding publishes no log
 * version: the log already follows exactly those blocks.
 */

export interface PlanSnapshot {
  schema: 1;
  channel_id: string;
  /** Active blocks only, each with its exceptions inlined. */
  blocks: GridBlock[];
  /** Every playlist/template a block uses, with its slots, so editing one never changes a published week. */
  lists: Record<string, SnapshotList>;
  /** Running orders from (today - 1) on; older ones are dropped at publish. */
  running_orders: SnapshotRunningOrder[];
}

/** The lists and running orders of a snapshot (older plans may lack them). */
export const snapshotContent = (s: PlanSnapshot | null | undefined): PlanContent => ({ lists: s?.lists ?? {}, running_orders: s?.running_orders ?? [] });

export interface PlanRow {
  id: string;
  channel_id: string;
  number: number;
  plan_json: string;
  summary: string;
  actor: "studio" | "system";
  based_on_number: number | null;
  rollback_of: number | null;
  version_id: string | null;
  effective_from_ms: number;
  created_at_ms: number;
}

export interface LoadedPlan {
  row: Omit<PlanRow, "plan_json">;
  snapshot: PlanSnapshot;
}

// Parsed snapshots by plan id (immutable, so they never go stale). The
// "which number is latest" lookup is one indexed row per call.
const parsed = new Map<string, PlanSnapshot>();

function parse(row: PlanRow): LoadedPlan {
  let snap = parsed.get(row.id);
  if (!snap) {
    snap = JSON.parse(row.plan_json) as PlanSnapshot;
    if (parsed.size > 200) parsed.clear();
    parsed.set(row.id, snap);
  }
  const { plan_json: _omit, ...rest } = row;
  return { row: rest, snapshot: snap };
}

export async function latestPlanRow(db: D1Database, channelId: string): Promise<PlanRow | null> {
  return db.prepare("SELECT * FROM sched_plans WHERE channel_id = ? ORDER BY number DESC LIMIT 1").bind(channelId).first<PlanRow>();
}

/** The channel's latest published plan, seeding plan #1 from the working copy if it has none. */
export async function latestPlan(db: D1Database, channelId: string): Promise<LoadedPlan | null> {
  const row = await latestPlanRow(db, channelId);
  if (row) return parse(row);
  const channel = await db.prepare("SELECT id FROM channels WHERE id = ?").bind(channelId).first();
  if (!channel) return null;
  const snapshot = await snapshotWorkingCopy(db, channelId);
  await insertPlan(db, {
    channelId,
    snapshot,
    summary: "Release 2: the weekly grid as it was",
    actor: "system",
    effectiveFromMs: Date.now(),
    versionId: null,
    basedOn: null,
  }).catch(() => {
    // Another request seeded it at the same moment (UNIQUE channel+number): use theirs.
  });
  const seeded = await latestPlanRow(db, channelId);
  return seeded ? parse(seeded) : null;
}

/** What airs on a channel: the latest published plan's active blocks and its lists and running orders. */
export async function airingPlan(db: D1Database, channelId: string): Promise<{ blocks: GridBlock[]; content: PlanContent }> {
  const plan = await latestPlan(db, channelId);
  return { blocks: (plan?.snapshot.blocks ?? []).filter((b) => b.active), content: snapshotContent(plan?.snapshot) };
}

/** A plan by number (for rollback and history). */
export async function planByNumber(db: D1Database, channelId: string, number: number): Promise<LoadedPlan | null> {
  const row = await db.prepare("SELECT * FROM sched_plans WHERE channel_id = ? AND number = ?").bind(channelId, number).first<PlanRow>();
  return row ? parse(row) : null;
}

/** The working copy as a snapshot (§1.5): active blocks with their exceptions, the lists they use, and running orders from yesterday on. */
export async function snapshotWorkingCopy(db: D1Database, channelId: string, nowMs = Date.now()): Promise<PlanSnapshot> {
  const blocks = await loadWorkingBlocks(db, channelId, false);
  return { schema: 1, channel_id: channelId, blocks, ...(await workingContent(db, channelId, blocks, nowMs)) };
}

/** Write the next plan number for a channel. Fails (UNIQUE) if another plan took that number first. */
export async function insertPlan(
  db: D1Database,
  p: {
    channelId: string;
    snapshot: PlanSnapshot;
    summary: string;
    actor: "studio" | "system";
    effectiveFromMs: number;
    versionId: string | null;
    basedOn: number | null;
    rollbackOf?: number | null;
  }
): Promise<{ id: string; number: number }> {
  const id = newId("pln");
  const latest = await db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM sched_plans WHERE channel_id = ?").bind(p.channelId).first<{ n: number }>();
  const number = (latest?.n ?? 0) + 1;
  await db
    .prepare(
      `INSERT INTO sched_plans (id, channel_id, number, plan_json, summary, actor, based_on_number, rollback_of, version_id, effective_from_ms, created_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, p.channelId, number, JSON.stringify(p.snapshot), p.summary, p.actor, p.basedOn, p.rollbackOf ?? null, p.versionId, p.effectiveFromMs, Date.now())
    .run();
  return { id, number };
}

/**
 * What the generator's fingerprint knows about a channel's plan. A plan with
 * no blocks gives "", exactly what Release 1's grid digest gave a channel
 * with an empty grid, so switching to plans rebuilds nothing (§2.6).
 */
export async function planDigests(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT p.channel_id, p.number, p.plan_json FROM sched_plans p
       WHERE p.number = (SELECT MAX(number) FROM sched_plans q WHERE q.channel_id = p.channel_id)`
    )
    .all<{ channel_id: string; number: number; plan_json: string }>();
  const out = new Map<string, string>();
  for (const r of results) {
    let blocks = 0;
    try {
      blocks = (JSON.parse(r.plan_json) as PlanSnapshot).blocks.length;
    } catch {
      blocks = 1;
    }
    if (blocks > 0) out.set(r.channel_id, `plan:${r.number}`);
  }
  return out;
}
