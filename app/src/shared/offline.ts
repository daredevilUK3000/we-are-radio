import { useEffect, useState, useSyncExternalStore } from "react";
import { publicApi, mediaUrl } from "../api/client";

/**
 * Offline listening: a listener downloads the next stretch of a live channel
 * (its running order from /api/schedule) and can play it back with no
 * connection.
 *
 * Everything lives in one Cache Storage cache, "war-offline": each song and
 * artwork file under its normal /media/... address (so the service worker
 * can also answer the site's ordinary players from it), plus a small list
 * of what was downloaded (BLOCKS_KEY). One download ("block") per channel;
 * downloading a channel again replaces its block. Only what the listener
 * asks for is ever stored - never the whole catalogue.
 *
 * Phones can clear this storage (iPhones after about a week without opening
 * the app), so playback always checks a file is still there.
 */

const CACHE = "war-offline";
const BLOCKS_KEY = "/__offline__/blocks.json";
const CHANGED = "war:offline-changed";

export interface OfflineItem {
  id: string;
  item_type: string;
  label: string | null;
  artist: string | null;
  album_title: string | null;
  duration_seconds: number;
  /** Absolute /media/... URL - the cache key. */
  audio: string;
  artwork: string | null;
}

export interface OfflineBlock {
  channelSlug: string;
  channelName: string;
  downloadedAt: string;
  minutes: number;
  items: OfflineItem[];
  bytes: number;
}

export interface DownloadProgress {
  channelSlug: string;
  done: number;
  total: number;
  /** How far through the file being downloaded now (0-1), so progress moves smoothly. */
  current: number;
  bytes: number;
  error: string | null;
  finished: boolean;
}

export const offlineSupported = typeof window !== "undefined" && "caches" in window;

export function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function absolute(url: string) {
  return new URL(url, window.location.href).href;
}

// ---- Stored blocks ----

export async function readBlocks(): Promise<OfflineBlock[]> {
  if (!offlineSupported) return [];
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(BLOCKS_KEY);
    return res ? ((await res.json()) as OfflineBlock[]) : [];
  } catch {
    return [];
  }
}

async function writeBlocks(blocks: OfflineBlock[]) {
  const cache = await caches.open(CACHE);
  await cache.put(BLOCKS_KEY, new Response(JSON.stringify(blocks), { headers: { "Content-Type": "application/json" } }));
}

function announce() {
  window.dispatchEvent(new Event(CHANGED));
  // The service worker keeps its own list of downloaded files.
  navigator.serviceWorker?.controller?.postMessage("offline-updated");
}

// Deletes stored files no block refers to any more (after a replace, a
// remove, or a cancelled download).
async function removeOrphans(blocks: OfflineBlock[]) {
  const cache = await caches.open(CACHE);
  const keep = new Set<string>([absolute(BLOCKS_KEY)]);
  for (const block of blocks) {
    for (const item of block.items) {
      keep.add(item.audio);
      if (item.artwork) keep.add(item.artwork);
    }
  }
  const keys = await cache.keys();
  await Promise.all(keys.filter((req) => !keep.has(req.url)).map((req) => cache.delete(req)));
}

export async function removeBlock(channelSlug: string) {
  const blocks = (await readBlocks()).filter((b) => b.channelSlug !== channelSlug);
  await writeBlocks(blocks);
  await removeOrphans(blocks);
  announce();
}

export async function removeAllDownloads() {
  if (!offlineSupported) return;
  await caches.delete(CACHE);
  announce();
}

/** A stored file as a playable blob: URL, or null if the phone has cleared it. */
export async function objectUrlFor(url: string): Promise<string | null> {
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(url);
    if (!res) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** How much the downloads take up, and how much the browser allows this site. */
export async function storageInfo(): Promise<{ usage: number | null; quota: number | null }> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

// ---- Downloading ----

let progress: DownloadProgress | null = null;
let controller: AbortController | null = null;
const subscribers = new Set<() => void>();

function setProgress(p: DownloadProgress | null) {
  progress = p;
  subscribers.forEach((fn) => fn());
}

/** The download in progress (or the last one's outcome), for any page to show. */
export function useDownloadProgress(): DownloadProgress | null {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => progress,
    () => progress
  );
}

/** 0-1 for a progress bar or ring (never goes backwards once started). */
export function downloadFraction(p: DownloadProgress): number {
  if (!p.total) return 0.04;
  return Math.max(0.04, Math.min(1, (p.done + p.current) / p.total));
}

export function cancelDownload() {
  controller?.abort();
}

// Fetches one file whole and stores it, counting bytes as they arrive.
async function storeFile(
  cache: Cache,
  url: string,
  signal: AbortSignal,
  onBytes: (n: number, fraction: number) => void
): Promise<number> {
  const existing = await cache.match(url);
  if (existing) {
    const size = (await existing.blob()).size;
    onBytes(size, 1);
    return size;
  }
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const expected = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length, expected ? Math.min(1, size / expected) : 0);
  }
  const blob = new Blob(chunks as BlobPart[], { type: res.headers.get("Content-Type") ?? "application/octet-stream" });
  await cache.put(
    url,
    new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size) } })
  );
  return size;
}

/**
 * Download the next `minutes` of a channel. Only live channels can be
 * downloaded (the schedule endpoint refuses the others). Resolves when done,
 * failed or cancelled - watch useDownloadProgress() for the outcome.
 */
export async function downloadBlock(channelSlug: string, minutes: number): Promise<void> {
  if (!offlineSupported || (progress && !progress.finished)) return;
  controller = new AbortController();
  const signal = controller.signal;
  setProgress({ channelSlug, done: 0, total: 0, current: 0, bytes: 0, error: null, finished: false });

  // Ask the browser not to clear downloads when space runs low (supported
  // on Android and recent iPhones; a refusal is fine - we still download).
  try {
    await navigator.storage?.persist?.();
  } catch {
    // ignore
  }

  let blocks = await readBlocks();
  try {
    const schedule = await publicApi.schedule(channelSlug, minutes);
    // Only files stored with us (R2) - not externally hosted podcast audio.
    const playable = schedule.items.filter((i) => i.audio_url && !/^https?:\/\//i.test(i.audio_url));
    if (!schedule.on_air || playable.length === 0) throw new Error("There's nothing on air to download right now.");

    const items: OfflineItem[] = playable.map((i) => ({
      id: `${i.id}@${i.starts_at}`,
      item_type: i.item_type,
      label: i.label,
      artist: i.artist ?? null,
      album_title: i.album_title ?? null,
      duration_seconds: i.duration_seconds,
      audio: absolute(mediaUrl(i.audio_url)),
      artwork: i.artwork_url && !/^https?:\/\//i.test(i.artwork_url) ? absolute(mediaUrl(i.artwork_url)) : null,
    }));
    const audioFiles = Array.from(new Set(items.map((i) => i.audio)));
    const artFiles = Array.from(new Set(items.map((i) => i.artwork).filter((a): a is string => !!a)));

    const cache = await caches.open(CACHE);
    let bytes = 0;
    const tick = (n: number, current: number) => {
      bytes += n;
      setProgress({ ...progress!, bytes, current });
    };
    setProgress({ ...progress!, total: audioFiles.length });
    for (let i = 0; i < audioFiles.length; i++) {
      await storeFile(cache, audioFiles[i], signal, tick);
      setProgress({ ...progress!, done: i + 1, current: 0 });
    }
    for (const art of artFiles) {
      try {
        await storeFile(cache, art, signal, (n) => tick(n, 0));
      } catch (err) {
        if (signal.aborted) throw err;
        // Missing artwork just means the station logo shows instead.
      }
    }

    const block: OfflineBlock = {
      channelSlug,
      channelName: schedule.channel?.name ?? channelSlug,
      downloadedAt: new Date().toISOString(),
      minutes,
      items,
      bytes,
    };
    blocks = [...blocks.filter((b) => b.channelSlug !== channelSlug), block];
    await writeBlocks(blocks);
    setProgress({ ...progress!, finished: true });
  } catch (err: any) {
    const message = signal.aborted
      ? "Download cancelled."
      : err?.name === "QuotaExceededError"
        ? "Your phone is out of space for downloads. Try a shorter download, or remove other downloads."
        : !navigator.onLine
          ? "You're offline - downloading needs a connection."
          : (err?.friendly ?? err?.message ?? "The download didn't finish. Please try again.");
    setProgress({ ...progress!, error: message, finished: true });
  } finally {
    controller = null;
    await removeOrphans(blocks).catch(() => {});
    announce();
  }
}

// ---- Hooks ----

/** The downloaded blocks, kept current as downloads are added or removed. */
export function useOfflineBlocks(): OfflineBlock[] | null {
  const [blocks, setBlocks] = useState<OfflineBlock[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => readBlocks().then((b) => !cancelled && setBlocks(b));
    load();
    window.addEventListener(CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, load);
    };
  }, []);
  return blocks;
}

/** navigator.onLine, live. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function formatBytes(n: number): string {
  if (n <= 0) return "0 MB";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/**
 * Ask the mini-player to play the downloads - a channel's, or (null) whichever
 * is there. Must be called straight from the tap (phones only start audio from one).
 */
export function playDownloads(channelSlug: string | null) {
  window.dispatchEvent(new CustomEvent("war:offline-play", { detail: { channelSlug } }));
}
