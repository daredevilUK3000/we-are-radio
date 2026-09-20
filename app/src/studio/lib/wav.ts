/**
 * Turn a recording into a plain WAV file.
 *
 * Browsers record microphones as WebM/Opus (Chrome, Firefox) or MP4 (Safari),
 * and not every device that will LISTEN can play every one of those. WAV plays
 * everywhere, and for a spoken clip of a few seconds the size doesn't matter
 * (16-bit mono is about 90 KB per second), so recordings are decoded and
 * re-written as mono 16-bit WAV before upload.
 */

/** 16-bit PCM mono WAV from float samples in -1..1. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/** Average all channels down to one. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  return out;
}

/** Decode a recorded blob (any format the browser can play) into a WAV blob. */
export async function recordingToWav(recording: Blob): Promise<{ blob: Blob; seconds: number }> {
  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctor();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const mono = mixToMono(channels);
    return {
      blob: new Blob([encodeWav(mono, decoded.sampleRate)], { type: "audio/wav" }),
      seconds: decoded.duration,
    };
  } finally {
    void context.close();
  }
}
