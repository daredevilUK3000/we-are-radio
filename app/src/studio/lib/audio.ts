// A file's own metadata can lie about its length: some VBR MP3s carry a
// broken header claiming minutes more (or less) than the audio really runs,
// and the station's running order is built from the length stored here - too
// short and the next song cuts in early, too long and there's dead air. So
// the upload pages decode the whole file, which counts the audio actually in
// it, and fall back to the metadata only if the browser can't decode it.
// Decoding holds the whole song in memory (~200 MB for 8 minutes), so it's
// done one file at a time even when Bulk Import uploads several at once.
let decodeQueue: Promise<unknown> = Promise.resolve();

export function decodedDuration(file: File, timeoutMs = 60_000): Promise<number | null> {
  const run = decodeQueue.then(async () => {
    const Ctor: typeof OfflineAudioContext | undefined =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctor) return null;
    const decode = (async () => {
      try {
        const context = new Ctor(1, 1, 44_100);
        const buffer = await context.decodeAudioData(await file.arrayBuffer());
        return buffer.duration > 0 ? buffer.duration : null;
      } catch {
        return null;
      }
    })();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return Promise.race([decode, timeout]);
  });
  decodeQueue = run.catch(() => {});
  return run;
}

// Reading duration from the file's own metadata is inherently a bit
// fragile (browser quirks, unusual encodings, slow metadata parsing) - and
// a failure here used to silently stall the entire upload/publish flow with
// no feedback, since the caller was just awaiting a promise that might
// never settle. This never rejects and never hangs indefinitely: after a
// short timeout, or on any error, it resolves with 0 rather than blocking
// publish on something that's correctable afterwards (edit the track).
export async function readAudioDuration(file: File): Promise<number> {
  const exact = await decodedDuration(file);
  if (exact) return Math.max(1, Math.round(exact));
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (seconds: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(seconds);
    };

    const timer = setTimeout(() => finish(0), 8000);

    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Math.round(audio.duration) || 0);
    audio.onerror = () => finish(0);
    audio.src = objectUrl;
  });
}
