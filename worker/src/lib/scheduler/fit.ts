import { contentKey, isDroppable, REPEAT_WINDOW_MS, TOLERANCE_MS, type FitChange, type PlanItem, type Playable } from "./types";

/**
 * Makes a run of items end exactly at `windowEnd`: the next grid block's hard
 * start, or a live control's recovery anchor. One routine for both.
 *
 * `items` are laid out back to back from `windowStart` (the first may begin
 * part-way into its file). In order:
 * 1. Too long by up to TOLERANCE_MS: the last item fades out early.
 * 2. Longer than that: droppable items (regular songs and station IDs) are
 *    dropped, closest to the anchor first, preferring one whose removal lands
 *    within the tolerance.
 * 3. Too short: the gap is filled from `pool` - songs not heard in the last
 *    two hours (`recent`, plus the run itself) - choosing the combination
 *    that overshoots least, and the last one fades.
 * Silence is never left. If nothing can be dropped the last item is simply
 * faded, which can mean a longer fade than the tolerance: a hard start wins.
 *
 * Returns the fitted items (startsAt/endsAt set) and what changed, so callers
 * can write reasons.
 */
export function fitToWindow(
  input: PlanItem[],
  windowStart: number,
  windowEnd: number,
  pool: Playable[],
  recent: Map<string, number>,
  reasonFor: { dropped: string; added: (gapMs: number) => string; trimmed: (ms: number) => string }
): { items: PlanItem[]; changes: FitChange[] } {
  const changes: FitChange[] = [];
  let items = layout(
    input.map((i) => ({ ...i, reasons: [...i.reasons] })),
    windowStart
  );
  // Fixed items are never dropped (Release 2): make room for the last one by dropping droppable items before it, nearest first.
  for (let guard = 0; guard < 500; guard++) {
    let lastFixed = -1;
    for (let k = items.length - 1; k >= 0; k--) if (items[k].fixed) { lastFixed = k; break; }
    if (lastFixed < 0 || items[lastFixed].startsAt < windowEnd) break;
    let k = lastFixed - 1;
    while (k >= 1 && !isDroppable(items[k])) k--;
    if (k < 1) break;
    const [gone] = items.splice(k, 1);
    changes.push({ kind: "dropped", item: gone, amountMs: gone.endsAt - gone.startsAt });
    items = layout(items, windowStart);
  }
  // Only what starts before the anchor can play before it.
  items = items.filter((i) => i.startsAt < windowEnd);
  if (items.length === 0 && windowEnd <= windowStart) return { items, changes };

  const end = () => (items.length ? items[items.length - 1].endsAt : windowStart);
  // What may be added: no song heard in the 2 hours before `at` (where the filler would start),
  // counting the run itself. Station IDs may repeat.
  const candidatesFor = (at: number, windowMs = REPEAT_WINDOW_MS) => {
    const last = new Map(recent);
    for (const i of items) last.set(contentKey(i), Math.max(last.get(contentKey(i)) ?? -Infinity, i.startsAt));
    const fresh = (p: Playable) => {
      if (p.itemType === "station_id") return true;
      const l = last.get(contentKey(p));
      return l === undefined || l < at - windowMs;
    };
    let c = pool.filter((p) => p.fileMs > 0 && fresh(p));
    if (c.filter((p) => p.itemType !== "station_id").length === 0) {
      // A pool too small to avoid a repeat: the song heard longest ago rather than silence.
      c = pool.filter((p) => p.fileMs > 0);
    }
    return c;
  };
  const addAll = (chosen: Playable[], gap: number) => {
    for (const p of chosen) {
      const added: PlanItem = { ...p, startsAt: 0, endsAt: 0, offset: 0, reasons: [...p.reasons, reasonFor.added(gap)] };
      items.push(added);
      changes.push({ kind: "added", item: added, amountMs: p.fileMs });
    }
    items = layout(items, windowStart);
  };

  // Too long or too short: look for the best way to land within the tolerance - drop the last few
  // droppable items (none, one, two or three) and fill what's left with the best 1-3 items.
  if (Math.abs(end() - windowEnd) > 0 && !(end() >= windowEnd && end() - windowEnd <= TOLERANCE_MS)) {
    // Fills start no earlier than the start of the 4th-last item.
    const fillFrom = items[Math.max(1, items.length - 4)]?.startsAt ?? windowStart;
    let best: { cut: number; combo: Playable[]; over: number } | null = null;
    // First only songs not heard for 2 hours; if nothing fits, songs not heard for 1 hour - better than cutting one by minutes.
    for (const windowMs of [REPEAT_WINDOW_MS, REPEAT_WINDOW_MS / 2]) {
    if (best) break;
    const cands = candidatesFor(fillFrom, windowMs);
    for (let cut = items.length, dropped = 0; cut >= 1 && dropped <= 3; cut--, dropped++) {
      if (cut < items.length && !isDroppable(items[cut])) break; // never drop past something that must stay
      const runEnd = cut === 0 ? windowStart : items[cut - 1].endsAt;
      const gap = windowEnd - runEnd;
      if (gap < 0) continue; // still too long even without these
      const combo = bestCombo(cands, gap);
      // Smallest overshoot wins; the loop goes from fewest drops up, so a tie keeps fewer drops.
      if (combo && combo.over <= TOLERANCE_MS && (!best || combo.over < best.over - 1000)) {
        best = { cut, combo: combo.items, over: combo.over };
        if (combo.over === 0) break;
      }
    }
    }
    if (best) {
      const gone = items.splice(best.cut);
      for (const g of gone) changes.push({ kind: "dropped", item: g, amountMs: g.endsAt - g.startsAt });
      items = layout(items, windowStart);
      addAll(best.combo, windowEnd - end());
    }
  }

  // Step 2: drop until no longer too long.
  for (let guard = 0; end() - windowEnd > TOLERANCE_MS && guard < 500; guard++) {
    const over = end() - windowEnd;
    // Prefer one drop that lands within [0, tolerance] - searching from the anchor backwards.
    let pick = -1;
    for (let k = items.length - 1; k >= 0; k--) {
      const len = items[k].endsAt - items[k].startsAt;
      if (isDroppable(items[k]) && k > 0 && over - len >= 0 && over - len <= TOLERANCE_MS) {
        pick = k;
        break;
      }
    }
    // Otherwise the droppable item closest to the anchor (never the one already on air, index 0 of a resumed run).
    if (pick < 0) {
      for (let k = items.length - 1; k >= 1; k--) {
        if (isDroppable(items[k])) {
          pick = k;
          break;
        }
      }
    }
    if (pick < 0) break;
    const [gone] = items.splice(pick, 1);
    changes.push({ kind: "dropped", item: gone, amountMs: gone.endsAt - gone.startsAt });
    items = layout(items, windowStart);
  }

  // Step 3: fill a gap.
  let gap = windowEnd - end();
  if (gap > 0) {
    const candidates = candidatesFor(end());
    const chosen = chooseFill(candidates, gap);
    if (chosen.length === 0 && changes.length > 0) {
      // Nothing to fill with: put the last dropped item back and fade it instead.
      const back = changes.pop()!;
      items.push(back.item);
      items = layout(items, windowStart);
    }
    addAll(chosen, gap);
    gap = windowEnd - end();
  }

  // Step 1 (and whatever is left): fade the last item so it ends on the anchor.
  const last = items[items.length - 1];
  if (last && last.endsAt > windowEnd) {
    const cut = last.endsAt - windowEnd;
    last.endsAt = windowEnd;
    last.reasons.push(reasonFor.trimmed(cut));
    changes.push({ kind: "trimmed", item: last, amountMs: cut });
  }
  for (const c of changes) if (c.kind === "dropped") c.item.reasons.push(reasonFor.dropped);
  return { items, changes };
}

/** Back to back from `start`, each for its full remaining length (or its trimmed length if already shorter). */
export function layout(items: PlanItem[], start: number): PlanItem[] {
  let cursor = start;
  return items.map((i) => {
    const natural = i.fileMs - i.offset;
    const current = i.endsAt > i.startsAt ? i.endsAt - i.startsAt : natural;
    const len = Math.min(natural, current);
    const out = { ...i, startsAt: cursor, endsAt: cursor + len };
    cursor += len;
    return out;
  });
}

/**
 * Items whose total reaches `gap` with the smallest overshoot: one item or a
 * pair landing within the tolerance if there is one, otherwise the longest
 * items that fit, topped up by the shortest that crosses the line.
 */
function chooseFill(candidates: Playable[], gap: number): Playable[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) => a.fileMs - b.fileMs);
  let best: Playable[] | null = null;
  let bestOver = Infinity;
  for (const a of sorted) {
    const over = a.fileMs - gap;
    if (over >= 0 && over < bestOver) {
      best = [a];
      bestOver = over;
    }
  }
  if (bestOver > TOLERANCE_MS) {
    const limit = Math.min(sorted.length, 150);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const over = sorted[i].fileMs + sorted[j].fileMs - gap;
        if (over >= 0 && over < bestOver) {
          best = [sorted[i], sorted[j]];
          bestOver = over;
        }
      }
    }
  }
  if (best && bestOver <= TOLERANCE_MS) return best;

  // Greedy: longest that still leave room, then the shortest that crosses the gap.
  const out: Playable[] = [];
  const used = new Set<Playable>();
  let left = gap;
  for (const p of [...sorted].reverse()) {
    if (p.fileMs < left) {
      out.push(p);
      used.add(p);
      left -= p.fileMs;
    }
    if (left <= 0) break;
  }
  if (left > 0) {
    const crossing = sorted.find((p) => !used.has(p) && p.fileMs >= left) ?? sorted.find((p) => !used.has(p)) ?? sorted[0];
    out.push(crossing);
    left -= crossing.fileMs;
  }
  // A tiny pool: go round it again rather than leave silence.
  for (let k = 0; left > 0 && k < 200; k++) {
    const p = sorted[sorted.length - 1 - (k % sorted.length)];
    out.push(p);
    left -= p.fileMs;
  }
  // A single long item may still beat the greedy set.
  if (best && best.length && bestOver < out.reduce((s, p) => s + p.fileMs, 0) - gap) return best;
  return out;
}

/**
 * The 1-3 items whose total reaches `gap` with the smallest overshoot:
 * singles, pairs, and a pair plus one short item (a station ID). Returns null
 * if the candidates can't reach the gap at all.
 */
export function bestCombo(cands: Playable[], gap: number): { items: Playable[]; over: number } | null {
  if (gap <= 0) return { items: [], over: -gap };
  const sorted = [...cands].sort((a, b) => a.fileMs - b.fileMs);
  const lens = sorted.map((p) => p.fileMs);
  let best: { items: Playable[]; over: number } | null = null;
  const consider = (ps: Playable[]) => {
    const keys = new Set(ps.map(contentKey));
    if (keys.size !== ps.length && ps.some((p) => p.itemType !== "station_id")) return;
    const over = ps.reduce((s, p) => s + p.fileMs, 0) - gap;
    if (over >= 0 && (!best || over < best.over)) best = { items: ps, over };
  };
  // Smallest length >= need, skipping index `skip`.
  const atLeast = (need: number, skip: number[]) => {
    let lo = 0;
    let hi = lens.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lens[mid] < need) lo = mid + 1;
      else hi = mid;
    }
    while (lo < lens.length && skip.includes(lo)) lo++;
    return lo < lens.length ? lo : -1;
  };
  const one = atLeast(gap, []);
  if (one >= 0) consider([sorted[one]]);
  for (let i = 0; i < sorted.length; i++) {
    const j = atLeast(gap - lens[i], [i]);
    if (j >= 0) consider([sorted[i], sorted[j]]);
    if (best && (best as { over: number }).over === 0) return best;
  }
  const shorts = sorted.map((p, i) => [p, i] as const).filter(([p]) => p.fileMs <= 60_000).slice(0, 12);
  for (const [s, si] of shorts) {
    for (let i = 0; i < sorted.length; i++) {
      if (i === si) continue;
      const j = atLeast(gap - s.fileMs - lens[i], [i, si]);
      if (j >= 0) consider([sorted[i], sorted[j], s]);
    }
    if (best && (best as { over: number }).over === 0) return best;
  }
  return best;
}
