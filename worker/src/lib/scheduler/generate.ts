import type { Channel, Env } from "../types";
import { hashSeed, ROTATION_RULES } from "../radioBrain";
import { airingPlan, planDigests, snapshotContent, type PlanSnapshot } from "./plans";
import { Planner, PlanError } from "./plan";
import { carryOverrides } from "./carry";
import { liveMax, logChange, publishVersion, type PublishResult, type VersionKind, type VersionRow } from "./store";
import { itemAt, itemsBetween } from "./timeline";
import { HOUR, parisDayTime } from "./time";
import { contentKey, type PlanItem } from "./types";

/**
 * The generator: every minute, for every channel, keep a validated log
 * running at least 47 hours ahead, and rebuild it when its inputs change.
 * It never edits a published version: it builds a new one (store.ts).
 */

export const HORIZON_MS = 48 * HOUR;
export const EXTEND_BELOW_MS = 47 * HOUR;

export interface SchedChannelRow {
  channel_id: string;
  enabled: number;
  enabled_at: string | null;
  last_run_at_ms: number | null;
  last_run_ok: number | null;
  consecutive_failures: number;
  inputs_fingerprint: string | null;
  on_fallback_since_ms: number | null;
  shadow_mismatches: number;
  shadow_checks: number;
  shadow_window_start_ms: number | null;
  shadow_last_mismatch_ms: number | null;
  shadow_since_ms: number | null;
  shadow_grace_until_ms: number | null;
}

/** How long shadow checks pause after a library-change rebuild takes effect. */
export const SHADOW_GRACE_MS = 2 * 60_000;

export async function latestVersion(db: D1Database, channelId: string): Promise<VersionRow | null> {
  return db
    .prepare("SELECT * FROM sched_versions WHERE channel_id = ? AND status = 'published' ORDER BY number DESC LIMIT 1")
    .bind(channelId)
    .first<VersionRow>();
}

/**
 * Where the log currently ends: the latest version's horizon. The latest
 * version governs everything after its effective time, so past its horizon
 * nothing is scheduled - even if an older version once reached further (a
 * rollback to a shorter version, say). Extensions continue from here.
 */
export async function furthestHorizon(db: D1Database, channelId: string): Promise<number | null> {
  return (await latestVersion(db, channelId))?.horizon_ms ?? null;
}

/**
 * What every channel's log is built from, in one cheap query: the catalogue,
 * jingles and their playback settings, pins, capsules, programmes, and the
 * channels themselves. Any edit to any of these changes it (so an edit
 * regenerates every channel, which keeps airing IDs and costs little).
 */
export async function catalogueDigest(db: D1Database): Promise<string> {
  const r = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM tracks WHERE status = 'published') AS tracks,
         (SELECT COUNT(*) || ':' || COALESCE(SUM(length(track_id) * tag_id), 0) FROM track_tags) AS tags,
         (SELECT COALESCE(group_concat(id || status || play_mode || duck_level || duck_fade_ms || duration_seconds), '')
            FROM audio_assets WHERE type IN ('station_id', 'jingle', 'promo')) AS ids,
         (SELECT COALESCE(group_concat(track_id || audio_asset_id || start_offset_seconds), '') FROM track_jingles) AS pins,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM time_capsules) AS capsules,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM programmes) AS programmes,
         (SELECT COUNT(*) || ':' || COALESCE(group_concat(programme_id || position || COALESCE(track_id, audio_asset_id)), '') FROM programme_items) AS items`
    )
    .first<Record<string, string>>();
  return String(hashSeed(JSON.stringify(r)));
}

export function channelFingerprint(channel: Channel, catalogue: string, gridDigest: string): string {
  // ROTATION_RULES: changing the rules (how often jingles play) rebuilds every channel's log too.
  return `${catalogue}|${ROTATION_RULES}|${hashSeed(
    [channel.programming_mode, channel.catalogue_rules ?? "", channel.name, channel.description ?? "", channel.status].join("|")
  )}|${gridDigest}`;
}

/** What each channel's log is built from on the plan side: its latest published plan (plans.ts). */
export async function gridDigests(db: D1Database): Promise<Map<string, string>> {
  return planDigests(db);
}

export type GenerateOutcome =
  | { status: "published"; version: VersionRow }
  | { status: "failed"; error: string }
  | { status: "nothing_to_play"; error: string }
  | { status: "skipped" };

/**
 * Builds a version from the plan and publishes it (with one rebuild if
 * someone else published first). `from` is where it takes effect.
 */
export async function buildFromPlan(
  env: Env,
  channel: Channel,
  opts: {
    kind: VersionKind;
    actor: VersionRow["actor"];
    from: number;
    to: number;
    summary: (to: number) => string;
    nowMs?: number;
    forceInvalid?: string;
    /** Test hook: make the build itself throw. */
    forceThrow?: boolean;
    /** Build from this snapshot instead of the latest published plan (publishing a new plan). */
    snapshot?: PlanSnapshot;
    action?: string | null;
    alongside?: (versionId: string) => D1PreparedStatement[];
  }
): Promise<GenerateOutcome> {
  const now = opts.nowMs ?? Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const expectedMax = await liveMax(env.DB, channel.id);
    const basedOn = expectedMax ? await latestVersion(env.DB, channel.id) : null;
    let plan: { items: PlanItem[]; toMs: number };
    let planner: Planner;
    try {
      if (opts.forceThrow) throw new Error("Generation forced to fail (test)");
      const source = opts.snapshot ? { blocks: opts.snapshot.blocks.filter((b) => b.active), content: snapshotContent(opts.snapshot) } : await airingPlan(env.DB, channel.id);
      planner = new Planner(env.DB, env.CONFIG, channel, source.blocks, now, source.content);
      // What ends right where this build starts: the new plan mustn't open with it again.
      const before = basedOn ? await itemAt(env.DB, channel.id, opts.from - 1) : null;
      const avoidFirst = before && before.item.endsAt === opts.from ? contentKey(before.item) : null;
      plan = await planner.build(opts.from, opts.to, { avoidFirst });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A channel with no programme or songs at all isn't failing: there's simply nothing to schedule.
      const nothing = err instanceof PlanError && /^Nothing to play/.test(message) && !basedOn;
      await recordRun(env.DB, channel.id, opts.kind, now, nothing, message);
      if (nothing) return { status: "nothing_to_play", error: message };
      return { status: "failed", error: message };
    }
    const baseItems = basedOn ? await itemsBetween(env.DB, channel.id, opts.from, Math.max(plan.toMs, basedOn.horizon_ms) + HOUR) : [];
    // Live changes survive a library rebuild and a plan publish (§2.7); Back on schedule and rollbacks drop them.
    let anchorMs: number | null = null;
    let kept: PlanItem[] = [];
    if (basedOn && (opts.kind === "generate" || (opts.kind === "grid" && opts.action === "publish"))) {
      const carried = await carryOverrides(env, channel, planner, basedOn, baseItems, plan.items, opts.from, now).catch((err) => {
        console.error("carrying live changes failed", err);
        return null;
      });
      if (carried) {
        plan = { ...plan, items: carried.items };
        anchorMs = carried.anchor;
        kept = carried.kept;
      }
    }
    const result: PublishResult = await publishVersion(env.DB, {
      channelId: channel.id,
      kind: opts.kind,
      actor: opts.actor,
      summary: opts.summary(plan.toMs),
      effectiveFrom: opts.from,
      items: plan.items,
      basedOn,
      baseItems,
      expectedMax,
      nowMs: now,
      forceInvalid: opts.forceInvalid,
      action: opts.action,
      alongside: opts.alongside,
      anchorMs,
      changes: kept.length
        ? [{ action: "kept", reason: `Kept ${kept.length === 1 ? "1 live change" : `${kept.length} live changes`} through the rebuild: ${kept.map((k) => k.label ?? "an item").join(", ")}`.slice(0, 500) }]
        : undefined,
    });
    if (result.ok) return { status: "published", version: result.version };
    if (!result.conflict) return { status: "failed", error: result.error };
  }
  return { status: "failed", error: "Someone else kept publishing first" };
}

async function recordRun(db: D1Database, channelId: string, kind: string, startedAt: number, ok: boolean, error: string | null) {
  await db
    .prepare("INSERT INTO sched_runs (channel_id, kind, started_at_ms, finished_at_ms, ok, error) VALUES (?,?,?,?,?,?)")
    .bind(channelId, kind, startedAt, Date.now(), ok ? 1 : 0, error?.slice(0, 500) ?? null)
    .run();
}

/**
 * A Hold in progress (Release 2, §8): a rebuild after a library change waits
 * until it has caught up, so a show Patrick moved isn't snapped back to its
 * usual time. Its catch-up anchor is an item boundary in the held log. Back
 * on schedule or a rollback after the hold ends it.
 */
export async function holdAnchor(db: D1Database, channelId: string, nowMs: number): Promise<number> {
  const hold = await db
    .prepare(
      `SELECT number, anchor_ms FROM sched_versions WHERE channel_id = ? AND status = 'published' AND action = 'hold' AND anchor_ms > ?
       ORDER BY number DESC LIMIT 1`
    )
    .bind(channelId, nowMs)
    .first<{ number: number; anchor_ms: number }>();
  if (!hold) return 0;
  const undone = await db
    .prepare("SELECT 1 FROM sched_versions WHERE channel_id = ? AND status = 'published' AND number > ? AND kind IN ('back_on_schedule','rollback') LIMIT 1")
    .bind(channelId, hold.number)
    .first();
  return undone ? 0 : hold.anchor_ms;
}

/** Where a regeneration takes over: the end of whatever is on air now, so it's never cut. */
export async function nextBoundary(db: D1Database, channelId: string, nowMs: number): Promise<number> {
  const on = await itemAt(db, channelId, nowMs);
  return on ? on.item.endsAt : nowMs;
}

/**
 * One channel's minute: regenerate if the inputs changed, extend if the log
 * is getting short, seed the fallback playlist the first time.
 */
export async function tickChannel(
  env: Env,
  channel: Channel,
  sc: SchedChannelRow,
  fingerprint: string,
  nowMs: number,
  test: { forceThrow?: boolean } = {}
): Promise<GenerateOutcome> {
  const latest = await latestVersion(env.DB, channel.id);
  let outcome: GenerateOutcome = { status: "skipped" };

  const regenerate = async () =>
    buildFromPlan(env, channel, {
      kind: "generate",
      actor: "generator",
      from: latest ? Math.max(await nextBoundary(env.DB, channel.id, nowMs), await holdAnchor(env.DB, channel.id, nowMs)) : nowMs,
      to: nowMs + HORIZON_MS,
      nowMs,
      forceThrow: test.forceThrow,
      summary: (to) => (latest ? `Rebuilt after a change, to ${parisDayTime(to)}` : `First log, to ${parisDayTime(to)}`),
    });

  if (!latest) {
    // No log yet. A channel with nothing to play is retried only when its inputs change.
    if (!(sc.last_run_ok === 1 && sc.inputs_fingerprint === fingerprint)) outcome = await regenerate();
  } else if (sc.inputs_fingerprint !== fingerprint) {
    outcome = await regenerate();
    // The old path reshuffled the moment the library changed; the log only
    // follows from its next boundary. Shadow checks sit that gap out.
    if (outcome.status === "published") {
      await env.DB.prepare("UPDATE sched_channels SET shadow_grace_until_ms = ? WHERE channel_id = ?")
        .bind(outcome.version.effective_from_ms + SHADOW_GRACE_MS, channel.id)
        .run();
    }
  } else if (latest.horizon_ms < nowMs + EXTEND_BELOW_MS) {
    outcome = await buildFromPlan(env, channel, {
      kind: "extend",
      actor: "generator",
      from: Math.max(latest.horizon_ms, nowMs),
      to: nowMs + HORIZON_MS,
      nowMs,
      forceThrow: test.forceThrow,
      summary: (to) => `Extended to ${parisDayTime(to)}`,
    });
  }

  if (outcome.status === "published" || outcome.status === "nothing_to_play") {
    await env.DB.prepare(
      `UPDATE sched_channels SET last_run_at_ms = ?, last_run_ok = 1, consecutive_failures = 0, inputs_fingerprint = ? WHERE channel_id = ?`
    )
      .bind(nowMs, fingerprint, channel.id)
      .run();
    if (outcome.status === "published") await seedFallbackIfEmpty(env.DB, channel.id, nowMs);
  } else if (outcome.status === "failed") {
    await env.DB.prepare(
      `UPDATE sched_channels SET last_run_at_ms = ?, last_run_ok = 0, consecutive_failures = consecutive_failures + 1 WHERE channel_id = ?`
    )
      .bind(nowMs, channel.id)
      .run();
  }
  return outcome;
}

/** The first time a channel gets a log, its emergency playlist is the first two hours of it (songs and station IDs only). */
async function seedFallbackIfEmpty(db: D1Database, channelId: string, nowMs: number) {
  const has = await db.prepare("SELECT 1 FROM sched_fallback_items WHERE channel_id = ? LIMIT 1").bind(channelId).first();
  if (has) return;
  const all = await itemsBetween(db, channelId, nowMs, nowMs + 2 * HOUR);
  let items = all.filter((i) => i.itemType === "song" || i.itemType === "station_id");
  // A talk or podcast channel has no songs: its own programme is the safer emergency loop than silence.
  if (items.length === 0) items = all.filter((i) => i.source !== "override");
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = i.trackId ?? i.assetId ?? "";
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return;
  const stmts = unique.map((i, n) =>
    db
      .prepare("INSERT OR IGNORE INTO sched_fallback_items (channel_id, position, track_id, audio_asset_id) VALUES (?,?,?,?)")
      .bind(channelId, n + 1, i.trackId, i.trackId ? null : i.assetId)
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  await logChange(db, {
    channelId,
    actor: "system",
    action: "fallback_set",
    reason: `Emergency playlist set to the first two hours of the log (${unique.length} items)`,
  });
}
