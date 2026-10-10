import type { Channel, Env } from "../types";
import { recordAired } from "./aired";
import { recentlyAired, recoveryPool } from "./actions";
import { fitToWindow, layout } from "./fit";
import { latestVersion } from "./generate";
import { occurrencesBetween, type Occurrence } from "./grid";
import { Planner } from "./plan";
import { airingPlan } from "./plans";
import { liveMax, publishVersion, type PendingChange, type VersionRow } from "./store";
import { clearTimelineCache, itemsBetween } from "./timeline";
import { addDaysTo, HOUR, MINUTE, mmss, parisDate, parisHHMM, parisWallClockToUtcMs } from "./time";
import { contentKey, TOLERANCE_MS, type PlanItem } from "./types";

/**
 * Hold (handoff_scheduler_release2.md §8): the one live control that
 * deliberately pushes the schedule later. It plays N more minutes of what's
 * on now, moves each hard start Patrick ticks N minutes later, and catches
 * up before the first hard start he didn't tick (or a High priority one,
 * which Hold can never move). It changes the log only, not the plan: the
 * next occurrence of a moved block is back at its normal time.
 */

export const HOLD_MINUTES = [5, 10, 15, 30] as const;

export interface HardStart {
  key: string;
  block_id: string;
  date: string;
  name: string;
  start_ms: number;
  high: boolean;
}

interface HoldContext {
  live: number;
  basedOn: VersionRow;
  timeline: Awaited<ReturnType<typeof itemsBetween>>;
  cur: PlanItem | null;
  /** Where the hold begins: the end of the airing on now. */
  S: number;
  /** Hard starts after S: today's (Paris) first, then later ones, for the catch-up. */
  starts: HardStart[];
  endOfToday: number;
  occs: Occurrence[];
}

async function context(env: Env, channel: Channel, nowMs: number): Promise<HoldContext | { error: string }> {
  const db = env.DB;
  const live = await liveMax(db, channel.id);
  if (!live) return { error: "This channel has no log yet." };
  const basedOn = (await latestVersion(db, channel.id))!;
  const timeline = await itemsBetween(db, channel.id, nowMs - 3 * HOUR, basedOn.horizon_ms + 1);
  const curIdx = timeline.findIndex((i) => i.startsAt <= nowMs && nowMs < Math.min(i.endsAt, i.cutAt ?? Infinity));
  const cur = curIdx >= 0 ? timeline[curIdx] : null;
  const S = cur ? Math.min(cur.endsAt, cur.cutAt ?? Infinity) : nowMs;
  const { blocks } = await airingPlan(db, channel.id);
  const occs = occurrencesBetween(blocks, S, basedOn.horizon_ms);
  const starts = occs
    // A block's own start (not a stretch resuming after a special), and a hard one.
    .filter((o) => o.startMs > S && (o.originMs ?? o.startMs) === o.startMs && (o.block.start_mode ?? "hard") === "hard")
    .map((o) => ({ key: `${o.block.id}:${o.date}`, block_id: o.block.id, date: o.date, name: o.block.name, start_ms: o.startMs, high: o.block.priority === "high" }));
  const endOfToday = parisWallClockToUtcMs(addDaysTo(parisDate(nowMs), 1), 0);
  return { live, basedOn, timeline, cur, S, starts, endOfToday, occs };
}

/** What the Hold dialog lists: the hard starts from now to the end of today, each with its moved time. */
export async function holdPreview(env: Env, channel: Channel, minutes: number, nowMs = Date.now()) {
  const ctx = await context(env, channel, nowMs);
  if ("error" in ctx) return { ok: false as const, message: ctx.error };
  const n = minutes * MINUTE;
  return {
    ok: true as const,
    live_version: ctx.live,
    from_ms: ctx.S,
    minutes,
    starts: ctx.starts
      .filter((s) => s.start_ms < ctx.endOfToday)
      .map((s) => ({ ...s, new_start_ms: s.start_ms + n, time: parisHHMM(s.start_ms), new_time: parisHHMM(s.start_ms + n) })),
  };
}

export type HoldResult = { ok: true; version: VersionRow; message: string } | { ok: false; status: 400 | 409 | 503; error: string; message: string };

export async function runHold(env: Env, channel: Channel, req: { minutes: number; move: string[]; expected_version: number }, nowMs = Date.now()): Promise<HoldResult> {
  const db = env.DB;
  if (!(HOLD_MINUTES as readonly number[]).includes(req.minutes)) return { ok: false, status: 400, error: "bad_minutes", message: "Hold for 5, 10, 15 or 30 minutes." };
  const ctx = await context(env, channel, nowMs);
  if ("error" in ctx) return { ok: false, status: 409, error: "no_log", message: ctx.error };
  if (req.expected_version !== ctx.live) return { ok: false, status: 409, error: "schedule_changed", message: "The schedule just changed. Here's the latest." };
  const { S, timeline, starts, endOfToday } = ctx;
  const n = req.minutes * MINUTE;
  const at = parisHHMM(nowMs);

  // Ticked hard starts move, in order, up to the first one that isn't ticked or is High priority.
  const ticked = new Set(req.move);
  const moved: HardStart[] = [];
  for (const s of starts) {
    if (s.start_ms >= endOfToday || s.high || !ticked.has(s.key)) break;
    moved.push(s);
  }
  const catchUp = starts.find((s) => !moved.includes(s));
  // No hard start left to catch up before: the first top of the hour at least 10 minutes after the held time.
  const C = catchUp ? catchUp.start_ms : Math.ceil((Math.max(S + n, moved.length ? moved[moved.length - 1].start_ms + n : 0) + 10 * MINUTE) / HOUR) * HOUR;
  const cLabel = parisHHMM(C);
  const refuse = (): HoldResult => ({
    ok: false,
    status: 409,
    error: "cant_catch_up",
    message: !catchUp
      ? `Hold can't catch up by ${cLabel}. Choose a shorter hold.`
      : catchUp.high
        ? `Hold can't catch up by ${cLabel}: ${catchUp.name} is High priority, so it keeps its time. Choose a shorter hold.`
        : catchUp.start_ms >= endOfToday
          ? `Hold can't catch up by ${cLabel}. Choose a shorter hold.`
          : `Hold can't catch up by ${cLabel}. Tick ${catchUp.name} to move it too, or choose a shorter hold.`,
  });

  const { blocks, content } = await airingPlan(db, channel.id);
  const planner = new Planner(db, env.CONFIG, channel, blocks, nowMs, content);
  const inBlock = ctx.cur?.blockId ? ctx.cur : null;
  const pool = await recoveryPool(env, channel, planner, inBlock, nowMs);
  const recent = await recentlyAired(db, channel.id, nowMs);
  for (const i of timeline) if (i.startsAt <= S && i.startsAt >= S - 2 * HOUR) recent.set(contentKey(i), i.startsAt);

  // 1. N more minutes of what's on now, from its pool.
  const head = fitToWindow([], S, S + n, pool, recent, {
    dropped: "Dropped by Hold",
    added: () => `Added by Hold: ${req.minutes} more minutes (by you at ${at})`,
    trimmed: (ms) => `Faded ${mmss(ms)} early to end the hold on time`,
  }).items.map((i) => ({ ...i, blockId: inBlock?.blockId ?? i.blockId, blockDate: inBlock?.blockDate ?? i.blockDate }));
  if (head.length === 0) return { ok: false, status: 503, error: "no_fill", message: "There's nothing to hold with: the block's pool is empty." };

  // 2. Everything from S up to the catch-up moves N later (same lengths, back to back).
  // An item a later version takes over part-way ends where that version begins (its cut), so the copy stays contiguous.
  const rest = timeline.filter((i) => i.startsAt >= S).map(({ versionId: _v, versionNumber: _n, cutAt, ...i }) => ({ ...i, endsAt: Math.min(i.endsAt, cutAt ?? Infinity) }) as PlanItem);
  const before = rest.filter((i) => i.startsAt < C);
  const shifted = layout([...head, ...before], S);
  // 3. The stretch after the last moved hard start (or after the hold itself) is fitted to land on the catch-up.
  const segStart = moved.length ? moved[moved.length - 1].start_ms + n : S + n;
  if (C <= segStart) return refuse();
  const keep = shifted.filter((i) => i.startsAt < segStart);
  const tailIn = shifted.filter((i) => i.startsAt >= segStart);
  for (const i of keep) recent.set(contentKey(i), i.startsAt);
  const fitted = fitToWindow(tailIn, segStart, C, pool, recent, {
    dropped: `Dropped so ${cLabel} keeps its time after Hold`,
    added: (gap) => `Added to fill ${mmss(gap)} after Hold`,
    trimmed: (ms) => `Faded ${mmss(ms)} early so ${cLabel} keeps its time after Hold`,
  });
  const fade = fitted.changes.find((c) => c.kind === "trimmed");
  // Nothing droppable left to absorb it (fixed items, a programme): refuse rather than fade minutes of it.
  if (fade && fade.amountMs > TOLERANCE_MS) return refuse();
  const items = [...keep, ...fitted.items, ...rest.filter((i) => i.startsAt >= C)];

  const changes: PendingChange[] = [];
  for (const h of head) changes.push({ action: "hold", item: h, after: { label: h.label }, reason: `Added by Hold (${req.minutes} min, by you at ${at})` });
  for (const m of moved) {
    const first = rest.find((i) => i.blockId === m.block_id && i.blockDate === m.date && i.startsAt === m.start_ms);
    changes.push({ action: "hold", airingId: first?.airingId ?? null, reason: `${m.name} moved ${req.minutes} minutes later by Hold, to ${parisHHMM(m.start_ms + n)} (confirmed by you)` });
  }
  for (const c of fitted.changes) {
    changes.push({
      action: "hold",
      item: c.kind === "added" ? c.item : undefined,
      airingId: c.kind === "added" ? undefined : (c.item.airingId ?? null),
      before: c.kind === "dropped" ? { label: c.item.label } : undefined,
      reason: c.item.reasons[c.item.reasons.length - 1] ?? c.kind,
    });
  }

  const summary = `Hold ${req.minutes} min${moved.length ? `: ${moved.map((m) => `${m.name} to ${parisHHMM(m.start_ms + n)}`).join(", ")}` : ""}`;
  const published = await publishVersion(db, {
    channelId: channel.id,
    kind: "insert_next",
    action: "hold",
    actor: "studio",
    summary,
    effectiveFrom: S,
    items,
    basedOn: ctx.basedOn,
    baseItems: timeline.filter((i) => i.endsAt > S),
    expectedMax: ctx.live,
    anchorMs: C,
    changes,
    nowMs,
  });
  if (!published.ok) {
    return published.conflict
      ? { ok: false, status: 409, error: "schedule_changed", message: "The schedule just changed. Here's the latest." }
      : { ok: false, status: 503, error: "build_failed", message: published.error };
  }
  clearTimelineCache(channel.id);
  await recordAired(db, channel.id, nowMs).catch(() => {});
  const caught = catchUp ? ` The schedule catches up by ${cLabel} (${catchUp.name} keeps its time).` : "";
  return { ok: true, version: published.version, message: `${summary}. Live as v${published.version.number}.${caught}` };
}
