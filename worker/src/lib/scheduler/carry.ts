import type { Channel, Env } from "../types";
import { anchorTarget, recentlyAired, recoveryPool } from "./actions";
import { fitToWindow } from "./fit";
import { occurrencesBetween } from "./grid";
import type { Planner } from "./plan";
import type { VersionRow } from "./store";
import type { TimelineItem } from "./timeline";
import { HOUR, MINUTE, mmss, parisHHMM } from "./time";
import { contentKey, TOLERANCE_MS, type PlanItem } from "./types";

/**
 * Live changes survive a rebuild (handoff §2.7). A regeneration (a library
 * change) or a plan publish rebuilds from the next item boundary; before
 * Release 2 that dropped any Insert next or voice note that hadn't started.
 * Now the base version's overrides waiting before its anchor are placed
 * again, in order, at the start of the new window, and the window is fitted
 * so the anchor keeps its time - exactly as the live control did. Their
 * airing IDs carry over (same content, not yet started). Back on schedule
 * and rollbacks don't come through here: they drop overrides on purpose.
 */
export async function carryOverrides(
  env: Env,
  channel: Channel,
  planner: Planner,
  basedOn: VersionRow,
  baseItems: TimelineItem[],
  planItems: PlanItem[],
  from: number,
  nowMs: number
): Promise<{ items: PlanItem[]; anchor: number; kept: PlanItem[] } | null> {
  // The window the live control recovered into ends at its anchor; without one, the hour after the rebuild point.
  const limit = basedOn.anchor_ms && basedOn.anchor_ms > from ? basedOn.anchor_ms : from + HOUR;
  const waiting = baseItems.filter((i) => i.source === "override" && i.startsAt >= from && i.startsAt < limit && Math.min(i.endsAt, i.cutAt ?? Infinity) > i.startsAt);
  if (waiting.length === 0 || planItems.length === 0) return null;
  const head: PlanItem[] = waiting.map(({ versionId: _v, versionNumber: _n, cutAt: _c, ...i }) => ({ ...(i as PlanItem), offset: 0 }));

  const blockStarts = occurrencesBetween(planner.blocks, from, from + 3 * HOUR).map((o) => o.startMs);
  const recent = await recentlyAired(env.DB, channel.id, nowMs);
  for (const i of baseItems) if (i.startsAt < from && i.startsAt >= from - 2 * HOUR) recent.set(contentKey(i), i.startsAt);
  const inBlock = planItems[0]?.blockId ? planItems[0] : null;
  const pool = await recoveryPool(env, channel, planner, inBlock, nowMs);
  const headMs = head.reduce((s, i) => s + i.fileMs, 0);

  for (let tries = 0; tries < 3; tries++) {
    const target = Math.max(anchorTarget(blockStarts, from, tries), from + headMs);
    const anchorItem = planItems.find((i) => i.startsAt >= target);
    if (!anchorItem) return null;
    const anchor = anchorItem.startsAt;
    const at = parisHHMM(anchor);
    const fitted = fitToWindow([...head, ...planItems.filter((i) => i.startsAt < anchor)], from, anchor, pool, recent, {
      dropped: `Dropped to keep ${at} on time with your live changes`,
      added: (gap) => `Added to fill ${mmss(gap)} around your live changes`,
      trimmed: (ms) => `Faded ${mmss(ms)} early to start ${at} on time`,
    });
    // Every carried item must still be there, whole.
    const allKept = head.every((h) => fitted.items.some((f) => contentKey(f) === contentKey(h) && f.source === "override" && f.endsAt - f.startsAt === f.fileMs));
    const trimmed = fitted.changes.find((c) => c.kind === "trimmed");
    if (!allKept || (trimmed && trimmed.amountMs > TOLERANCE_MS && tries < 2)) continue;
    return { items: [...fitted.items, ...planItems.filter((i) => i.startsAt >= anchor)], anchor, kept: head };
  }
  return null;
}
