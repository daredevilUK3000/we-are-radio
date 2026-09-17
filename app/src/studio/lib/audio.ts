// Reading duration from the file's own metadata is inherently a bit
// fragile (browser quirks, unusual encodings, slow metadata parsing) - and
// a failure here used to silently stall the entire upload/publish flow with
// no feedback, since the caller was just awaiting a promise that might
// never settle. This never rejects and never hangs indefinitely: after a
// short timeout, or on any error, it resolves with 0 rather than blocking
// publish on something that's correctable afterwards (edit the track).
export function readAudioDuration(file: File): Promise<number> {
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
