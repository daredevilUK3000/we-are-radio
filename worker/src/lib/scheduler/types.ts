import type { RotationOverlay } from "../radioBrain";

export type ItemSource = "programme" | "autopilot" | "capsule" | "override" | "fallback";

/** One airing in a plan or a published log (the in-memory form of sched_log_items). */
export interface PlanItem {
  startsAt: number;
  endsAt: number;
  /** How far into the file the airing begins (ms). */
  offset: number;
  itemType: string;
  trackId: string | null;
  assetId: string | null;
  label: string | null;
  audioUrl: string;
  artworkUrl: string | null;
  fileMs: number;
  overlays?: RotationOverlay[];
  blockId: string | null;
  blockDate: string | null;
  source: ItemSource;
  sourceRef: string | null;
  reasons: string[];
  airingId?: string;
}

/** Something that can be put on the air: a song or an audio asset, before it has a time. */
export type Playable = Omit<PlanItem, "startsAt" | "endsAt" | "offset" | "airingId">;

export const contentKey = (i: { trackId: string | null; assetId: string | null }) =>
  i.trackId ? `t:${i.trackId}` : `a:${i.assetId}`;

/** Songs and station IDs from the regular plan can be dropped to keep the clock; nothing else can. */
export const isDroppable = (i: PlanItem | Playable) =>
  (i.source === "autopilot" || i.source === "programme" || i.source === "fallback") &&
  (i.itemType === "song" || i.itemType === "station_id");

/** Recovery tolerance: up to this much over is absorbed by fading the last item early. */
export const TOLERANCE_MS = 20_000;
export const REPEAT_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface FitChange {
  kind: "dropped" | "added" | "trimmed";
  item: PlanItem;
  amountMs: number;
}
