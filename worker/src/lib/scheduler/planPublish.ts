import type { Channel, Env } from "../types";
import { newId } from "../id";
import { blockRecurringLabel } from "../guide";
import { buildFromPlan, HORIZON_MS, latestVersion, nextBoundary, type SchedChannelRow } from "./generate";
import { loadWorkingBlocks, occurrencesBetween, type GridBlock, type Occurrence } from "./grid";
import { latestPlan, planByNumber, snapshotWorkingCopy, type PlanSnapshot } from "./plans";
import { writeBlockStatements } from "./planEdit";
import { logChange } from "./store";
import { addDaysTo, DAY, hhmm, parisDate, parisHHMM } from "./time";
import { clearTimelineCache, itemAt } from "./timeline";
import { redIssues, shortDate, validatePlan, type PlanIssue } from "./validate";

/**
 * The working copy against the published plan (handoff §4.2-4.4): what's
 * changed in words, when it first makes a difference on air, and
 * publishing, discarding and rolling back - one channel at a time, each
 * atomic with its log version.
 */

// ------------------------------------------------------------------ describing and diffing

/** "every Friday 18:00–19:00", "Fri 16 Oct 20:00–21:00", "the 15th of every month 10:00–11:00" */
export function describeWhen(b: GridBlock): string {
  const times = `${hhmm(b.start_min)}–${hhmm(b.end_min)}`;
  if ((b.recurrence ?? "weekly") === "once") return `${b.once_date ? shortDate(b.once_date) : "once"} ${times}`;
  const rep = (blockRecurringLabel(b) ?? "").replace(/^Every /, "every ").replace(/^Weekdays/, "weekdays").replace(/^Weekends/, "weekends");
  const season = b.date_from || b.date_to ? ` (${b.date_from ? shortDate(b.date_from) : "…"} to ${b.date_to ? shortDate(b.date_to) : "…"})` : "";
  return `${rep.charAt(0).toLowerCase()}${rep.slice(1)} ${times}${season}`;
}

/** What makes two blocks different (timestamps don't). */
const AIR_FIELDS = [
  "recurrence", "days_mask", "once_date", "monthly_rule", "date_from", "date_to", "start_min", "end_min", "layer",
  "start_mode", "end_mode", "priority", "mode", "fill_kind", "programme_id", "list_id", "tags_any_json", "when_short", "active",
] as const;
const SHOW_FIELDS = ["name", "description", "colour", "public"] as const;
const norm = (v: unknown) => (v === undefined ? null : v);
const fieldsDiffer = (a: GridBlock, b: GridBlock, fields: readonly string[]) =>
  fields.filter((f) => JSON.stringify(norm((a as never)[f])) !== JSON.stringify(norm((b as never)[f])));
const exceptionsOf = (b: GridBlock) => [...(b.exceptions ?? [])].sort();

export interface DraftChange {
  text: string;
  block_id?: string;
}

/** Plain sentences for each difference between the live plan's blocks and the working copy's (active blocks only). */
export function draftChanges(live: GridBlock[], working: GridBlock[]): DraftChange[] {
  const out: DraftChange[] = [];
  const L = new Map(live.filter((b) => b.active).map((b) => [b.id, b]));
  const W = new Map(working.filter((b) => b.active).map((b) => [b.id, b]));
  for (const [id, w] of W) {
    const l = L.get(id);
    if (!l) {
      const what = (w.recurrence ?? "weekly") === "once" ? "New one-off" : w.date_from || w.date_to ? "New seasonal block" : "New block";
      out.push({ text: `${what}: ${w.name}, ${describeWhen(w)}`, block_id: id });
      continue;
    }
    const air = fieldsDiffer(l, w, AIR_FIELDS);
    const show = fieldsDiffer(l, w, SHOW_FIELDS);
    const exL = exceptionsOf(l);
    const exW = exceptionsOf(w);
    const added = exW.filter((d) => !exL.includes(d));
    const removed = exL.filter((d) => !exW.includes(d));
    const name = w.name;
    const whenFields = ["recurrence", "days_mask", "once_date", "monthly_rule", "date_from", "date_to", "start_min", "end_min"];
    if (air.some((f) => whenFields.includes(f))) out.push({ text: `${name} moved from ${describeWhen(l)} to ${describeWhen(w)}`, block_id: id });
    if (air.includes("fill_kind") || air.includes("programme_id") || air.includes("tags_any_json")) out.push({ text: `${name}: what fills it changed`, block_id: id });
    const behaviour = air.filter((f) => ["start_mode", "end_mode", "priority", "layer", "mode", "when_short"].includes(f));
    if (behaviour.length) {
      const words: Record<string, string> = { start_mode: "start", end_mode: "end", priority: "priority", layer: "layer", mode: "mode", when_short: "short fill" };
      out.push({ text: `${name}: ${behaviour.map((f) => words[f]).join(", ")} changed`, block_id: id });
    }
    if (show.includes("name")) out.push({ text: `${l.name} renamed ${w.name}`, block_id: id });
    if (show.includes("description")) out.push({ text: `${name}: new description`, block_id: id });
    if (show.includes("public")) out.push({ text: w.public === 0 ? `${name} hidden from the public schedule` : `${name} shown on the public schedule`, block_id: id });
    if (show.includes("colour")) out.push({ text: `${name}: new colour`, block_id: id });
    for (const d of added) out.push({ text: `${name} skips ${shortDate(d)}`, block_id: id });
    for (const d of removed) out.push({ text: `${name} airs again on ${shortDate(d)}`, block_id: id });
  }
  for (const [id, l] of L) if (!W.has(id)) out.push({ text: `Removed ${l.name} (${describeWhen(l)})`, block_id: id });
  return out;
}

const segKey = (o: Occurrence) => {
  const b = o.block as unknown as Record<string, unknown>;
  return [o.startMs, o.endMs, o.originMs ?? o.startMs, o.block.id, ...AIR_FIELDS.map((f) => JSON.stringify(norm(b[f])))].join("|");
};

/** The first instant (from fromMs) at which the two block sets air differently, or null if they never do before toMs. */
export function firstChangeMs(live: GridBlock[], working: GridBlock[], fromMs: number, toMs: number): number | null {
  const a = occurrencesBetween(live.filter((b) => b.active), fromMs, toMs);
  const b = occurrencesBetween(working.filter((b) => b.active), fromMs, toMs);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x && y && segKey(x) === segKey(y)) continue;
    const t = Math.min(x?.startMs ?? Infinity, y?.startMs ?? Infinity);
    return Math.max(fromMs, t);
  }
  return null;
}

/** Whether two block sets are the same plan (what airs and what's shown). */
export function sameBlocks(live: GridBlock[], working: GridBlock[]): boolean {
  return draftChanges(live, working).length === 0;
}

// ------------------------------------------------------------------ draft summary

export interface ChannelDraft {
  slug: string;
  name: string;
  live_plan: number | null;
  live_version: number | null;
  changes: DraftChange[];
  issues: PlanIssue[];
  first_change_ms: number | null;
  can_publish: boolean;
  why_not: string | null;
}

async function schedRow(db: D1Database, channelId: string) {
  return db.prepare("SELECT * FROM sched_channels WHERE channel_id = ?").bind(channelId).first<SchedChannelRow>();
}

/** Who can publish (§4.3): a channel on the Scheduler, or a hidden channel being built. */
export async function publishBlocker(db: D1Database, channel: Channel): Promise<string | null> {
  const sc = await schedRow(db, channel.id);
  if (sc?.enabled || channel.status === "building") return null;
  return "This channel is still in shadow mode: its plan can be edited, and published once it's on air through the Scheduler.";
}

export async function channelDraft(env: Env, channel: Channel, nowMs: number): Promise<ChannelDraft> {
  const plan = await latestPlan(env.DB, channel.id);
  const live = plan?.snapshot.blocks ?? [];
  const working = await loadWorkingBlocks(env.DB, channel.id, true);
  const changes = draftChanges(live, working);
  const issues = await validatePlan(env.DB, channel, working, nowMs);
  const latest = await latestVersion(env.DB, channel.id);
  const blocker = await publishBlocker(env.DB, channel);
  return {
    slug: channel.slug,
    name: channel.name,
    live_plan: plan?.row.number ?? null,
    live_version: latest?.number ?? null,
    changes,
    issues,
    first_change_ms: changes.length ? firstChangeMs(live, working, nowMs, nowMs + 60 * DAY) : null,
    can_publish: changes.length > 0 && !blocker && redIssues(issues).length === 0,
    why_not: blocker ?? (redIssues(issues).length ? `${redIssues(issues).length} problem${redIssues(issues).length === 1 ? "" : "s"} to fix first` : null),
  };
}

// ------------------------------------------------------------------ publishing

export type PublishOutcome =
  | { ok: true; plan: number; version: number | null; goes_live_ms: number | null; message: string }
  | { ok: false; status: number; error: string; message: string; issues?: PlanIssue[]; live_plan?: number | null };

/** "Tuesday 06:00" style, in Paris time (the Studio's clock). */
/** "now", "today 19:00", "tomorrow 06:00", "Fri 16 Oct 19:00" (Paris). */
export function whenText(ms: number, nowMs: number): string {
  if (ms - nowMs < 2 * 60_000) return "now";
  const day = parisDate(ms);
  const time = parisHHMM(ms);
  if (day === parisDate(nowMs)) return `today ${time}`;
  if (day === addDaysTo(parisDate(nowMs), 1)) return `tomorrow ${time}`;
  return `${shortDate(day)} ${time}`;
}

/**
 * Publish a snapshot as the channel's next plan (§4.3): refuse on a stale
 * expected number or a red issue; build the log from the later of the first
 * change and the end of the airing on now; and commit the plan row in the
 * same batch as the log's compare-and-swap, so a plan exists only if its log
 * version won. A change beyond the log's horizon is a plan with no version:
 * the generator picks it up when it extends.
 */
export async function publishSnapshot(
  env: Env,
  channel: Channel,
  opts: { expected: number | null; snapshot?: PlanSnapshot; summary?: string; rollbackOf?: number; nowMs?: number; forceInvalid?: string }
): Promise<PublishOutcome> {
  const db = env.DB;
  const nowMs = opts.nowMs ?? Date.now();
  const latest = await latestPlan(db, channel.id);
  const liveNumber = latest?.row.number ?? null;
  const latestVer = await latestVersion(db, channel.id);
  const unchanged = `The live schedule is unchanged (Plan ${liveNumber ?? "–"}${latestVer ? `, v${latestVer.number}` : ""})`;
  if (opts.expected !== liveNumber) {
    return { ok: false, status: 409, error: "plan_changed", message: "The plan changed in another tab. Here's the latest.", live_plan: liveNumber };
  }
  const blocker = await publishBlocker(db, channel);
  if (blocker) return { ok: false, status: 409, error: "not_publishable", message: `Publication cancelled. ${unchanged}: ${blocker}` };

  const snapshot = opts.snapshot ?? (await snapshotWorkingCopy(db, channel.id));
  const live = latest?.snapshot.blocks ?? [];
  const changes = draftChanges(live, snapshot.blocks);
  if (!opts.rollbackOf && changes.length === 0) return { ok: false, status: 400, error: "no_changes", message: "There's nothing to publish on this channel." };
  const issues = await validatePlan(db, channel, snapshot.blocks, nowMs);
  const reds = redIssues(issues);
  if (reds.length) return { ok: false, status: 400, error: "invalid", message: `Publication cancelled. ${unchanged}: ${reds[0].text}.`, issues };

  const number = (liveNumber ?? 0) + 1;
  const summary = (opts.summary ?? (changes.map((c) => c.text).join(" · ") || "No changes")).slice(0, 500);
  const planId = newId("pln");
  const json = JSON.stringify(snapshot);
  const first = firstChangeMs(live, snapshot.blocks, nowMs, nowMs + 400 * DAY);
  const horizon = latestVer?.horizon_ms ?? null;
  const action = opts.rollbackOf ? "plan_rollback" : "publish";

  const finish = async (versionId: string | null) => {
    // The generator's fingerprint now names the new plan: no second rebuild on the next minute.
    // Only the plan part is replaced, so a library change still waiting is still noticed.
    const sc = await schedRow(db, channel.id);
    const digest = snapshot.blocks.length ? `plan:${number}` : "";
    if (sc?.inputs_fingerprint) {
      await db.prepare("UPDATE sched_channels SET inputs_fingerprint = ? WHERE channel_id = ?").bind(sc.inputs_fingerprint.replace(/\|[^|]*$/, `|${digest}`), channel.id).run();
    }
    clearTimelineCache(channel.id);
    await env.CONFIG.delete(`sched:health:${channel.id}`);
    if (!versionId) await logChange(db, { channelId: channel.id, actor: "studio", action, reason: `Published Plan ${number}: ${summary}`.slice(0, 500) });
  };

  if (first !== null && horizon !== null && first < horizon) {
    // Never mid-song: from the later of the end of the airing on now and the start of the airing the change falls in.
    const boundary = await nextBoundary(db, channel.id, nowMs);
    const at = await itemAt(db, channel.id, first);
    const from = Math.max(boundary, at && at.item.startsAt < first ? at.item.startsAt : first);
    const out = await buildFromPlan(env, channel, {
      kind: "grid",
      actor: "studio",
      action,
      blocks: snapshot.blocks,
      from,
      to: Math.max(horizon, nowMs + HORIZON_MS),
      nowMs,
      forceInvalid: opts.forceInvalid,
      summary: () => (opts.rollbackOf ? `Rolled back to Plan ${opts.rollbackOf}` : `Plan ${number}: ${summary}`).slice(0, 300),
      alongside: (versionId) => [
        db
          .prepare(
            `INSERT INTO sched_plans (id, channel_id, number, plan_json, summary, actor, based_on_number, rollback_of, version_id, effective_from_ms, created_at_ms)
             SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sched_versions WHERE id = ? AND status = 'published')`
          )
          .bind(planId, channel.id, number, json, summary, "studio", liveNumber, opts.rollbackOf ?? null, versionId, from, Date.now(), versionId),
        db
          .prepare(
            `INSERT INTO sched_changes (channel_id, version_id, at_ms, actor, action, airing_id, before_json, after_json, reason)
             SELECT ?,?,?,?,?,NULL,NULL,NULL,? WHERE EXISTS (SELECT 1 FROM sched_versions WHERE id = ? AND status = 'published')`
          )
          .bind(channel.id, versionId, Date.now(), "studio", action, `Published Plan ${number}: ${summary}`.slice(0, 500), versionId),
      ],
    });
    if (out.status !== "published") {
      const why = out.status === "failed" ? out.error : out.status === "nothing_to_play" ? out.error : "nothing to schedule";
      return { ok: false, status: 503, error: "build_failed", message: `Publication cancelled. ${unchanged}: ${why}.` };
    }
    const row = await db.prepare("SELECT number FROM sched_plans WHERE id = ?").bind(planId).first<{ number: number }>();
    if (!row) return { ok: false, status: 409, error: "plan_changed", message: "The plan changed in another tab. Here's the latest.", live_plan: liveNumber };
    await finish(out.version.id);
    return { ok: true, plan: number, version: out.version.number, goes_live_ms: from, message: `Published as Plan ${number}. Goes live ${whenText(from, nowMs)}.` };
  }

  // Beyond the log (or nothing on air changes): a plan with no log version yet.
  const effective = first ?? nowMs;
  try {
    await db
      .prepare(
        `INSERT INTO sched_plans (id, channel_id, number, plan_json, summary, actor, based_on_number, rollback_of, version_id, effective_from_ms, created_at_ms)
         VALUES (?,?,?,?,?,?,?,?,NULL,?,?)`
      )
      .bind(planId, channel.id, number, json, summary, "studio", liveNumber, opts.rollbackOf ?? null, effective, Date.now())
      .run();
  } catch {
    return { ok: false, status: 409, error: "plan_changed", message: "The plan changed in another tab. Here's the latest.", live_plan: liveNumber };
  }
  await finish(null);
  const message =
    first === null
      ? `Published as Plan ${number}. Nothing on air changes; the public schedule updates within 5 minutes.`
      : `Published as Plan ${number}. Goes live ${whenText(first, nowMs)}.`;
  return { ok: true, plan: number, version: null, goes_live_ms: first, message };
}

// ------------------------------------------------------------------ discard and rollback

/** Reset a channel's working copy to a snapshot (its blocks and their exceptions). */
export async function resetWorkingCopy(db: D1Database, channelId: string, snapshot: PlanSnapshot) {
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM sched_block_exceptions WHERE block_id IN (SELECT id FROM sched_blocks WHERE channel_id = ?)").bind(channelId),
    db.prepare("DELETE FROM sched_blocks WHERE channel_id = ?").bind(channelId),
    ...snapshot.blocks.flatMap((b) => writeBlockStatements(db, { ...b, channel_id: channelId })),
  ];
  // One batch is one transaction: the working copy is never half-reset.
  await db.batch(stmts);
}

export async function discardDraft(db: D1Database, channel: Channel): Promise<{ discarded: number }> {
  const plan = await latestPlan(db, channel.id);
  const working = await loadWorkingBlocks(db, channel.id, true);
  const n = draftChanges(plan?.snapshot.blocks ?? [], working).length;
  await resetWorkingCopy(db, channel.id, plan?.snapshot ?? { schema: 1, channel_id: channel.id, blocks: [], lists: {}, running_orders: [] });
  return { discarded: n };
}

export async function rollbackPlan(env: Env, channel: Channel, number: number, expected: number | null, nowMs = Date.now()): Promise<PublishOutcome> {
  const target = await planByNumber(env.DB, channel.id, number);
  if (!target) return { ok: false, status: 404, error: "not_found", message: `There's no Plan ${number}.` };
  const out = await publishSnapshot(env, channel, { expected, snapshot: { ...target.snapshot, channel_id: channel.id }, summary: `Rolled back to Plan ${number}`, rollbackOf: number, nowMs });
  if (out.ok) await resetWorkingCopy(env.DB, channel.id, target.snapshot);
  return out;
}
