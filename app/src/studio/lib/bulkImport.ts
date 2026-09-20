// Helpers for the Studio's Bulk Import page: reading files in the browser
// (fingerprint, length), uploading with progress, and small utilities.

export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma)$/i;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
}

/**
 * How the same file is recognised in a later session. A browser can't
 * remember a folder, so name + size + last-modified stands in for "this file":
 * pick the folder again and saved titles reappear on the matching files.
 */
export function fileKeyOf(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** "Track 2" before "Track 10" - the order a person expects from a folder. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** SHA-256 of the file's bytes, as hex - identical to hashing the uploaded object. */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length in whole seconds, read from the file's own metadata. */
export function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = window.setTimeout(() => done(() => reject(new Error("Could not read this file's length"))), 20_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      done(() =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? resolve(Math.max(1, Math.round(audio.duration)))
          : reject(new Error("Could not read this file's length"))
      );
    audio.onerror = () => done(() => reject(new Error("This file could not be read as audio")));
    audio.src = url;
  });
}

/** PUT a file to a presigned URL, reporting 0-100 as it goes. */
export function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed - check your connection"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

export function humanSize(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
