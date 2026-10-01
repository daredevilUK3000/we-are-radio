import { encodeWav } from "../../shared/wav";

/**
 * Preparing a listener's voice note for air, in Patrick's browser (the Worker
 * does no audio processing). From the decoded mono recording:
 *
 * 1. trim to the handles (default: leading/trailing silence below -45 dBFS
 *    cut, keeping 150 ms);
 * 2. high-pass at 80 Hz to remove handling rumble;
 * 3. level: RMS over the non-silent parts to about -18 dBFS, the gain capped
 *    so the peak stays under -1 dBFS, and never more than +18 dB;
 * 4. 20 ms fades in and out;
 * 5. optionally Kizzi's intro first (400 ms of silence, then the listener)
 *    and/or an outro after, each through steps 1-4 too;
 * 6. rendered at 44.1 kHz mono 16-bit, padded with silence to a whole number
 *    of seconds (the log schedules whole seconds, so nothing is ever cut).
 */

export const OUT_RATE = 44_100;
const SILENCE_DB = -45;
const KEEP_MS = 150;
const TARGET_RMS_DB = -18;
const PEAK_CEILING_DB = -1;
const MAX_GAIN_DB = 18;
const FADE_MS = 20;
const GAP_MS = 400;

const dbToAmp = (db: number) => Math.pow(10, db / 20);
export const ampToDb = (a: number) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

export interface Clip {
  samples: Float32Array;
  rate: number;
}

/** Default trim handles (seconds): silence below -45 dBFS cut from each end, keeping 150 ms. */
export function autoTrim({ samples, rate }: Clip): { start: number; end: number } {
  const threshold = dbToAmp(SILENCE_DB);
  const win = Math.max(1, Math.round(rate * 0.01));
  const loud = (i: number) => {
    let peak = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) peak = Math.max(peak, Math.abs(samples[j]));
    return peak >= threshold;
  };
  let first = 0;
  while (first < samples.length && !loud(first)) first += win;
  let last = samples.length - win;
  while (last > first && !loud(last)) last -= win;
  const total = samples.length / rate;
  if (first >= samples.length) return { start: 0, end: total };
  const keep = KEEP_MS / 1000;
  return { start: Math.max(0, first / rate - keep), end: Math.min(total, (last + win) / rate + keep) };
}

/** Trim, high-pass and resample to OUT_RATE in one OfflineAudioContext render. */
async function filterAndResample({ samples, rate }: Clip, start: number, end: number): Promise<Float32Array> {
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(samples.length, Math.ceil(end * rate));
  const slice = samples.subarray(from, Math.max(from + 1, to));
  const length = Math.max(1, Math.round((slice.length * OUT_RATE) / rate));
  const Offline: typeof OfflineAudioContext = window.OfflineAudioContext ?? (window as any).webkitOfflineAudioContext;
  const ctx = new Offline(1, length, OUT_RATE);
  const buf = ctx.createBuffer(1, slice.length, rate);
  buf.getChannelData(0).set(slice);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  hp.Q.value = Math.SQRT1_2;
  src.connect(hp).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

export interface LevelReport {
  rmsBeforeDb: number;
  rmsAfterDb: number;
  peakAfterDb: number;
  gainDb: number;
}

/** RMS of the non-silent 50 ms windows (so pauses don't drag the level down). */
export function speechRms(samples: Float32Array, rate: number): number {
  const win = Math.max(1, Math.round(rate * 0.05));
  const gate = dbToAmp(SILENCE_DB);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    const rms = Math.sqrt(s / (end - i));
    if (rms >= gate) {
      sum += s;
      n += end - i;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

function level(samples: Float32Array, rate: number): LevelReport {
  const rms = speechRms(samples, rate);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  let gainDb = rms > 0 ? TARGET_RMS_DB - ampToDb(rms) : 0;
  gainDb = Math.min(gainDb, MAX_GAIN_DB);
  if (peak > 0) gainDb = Math.min(gainDb, PEAK_CEILING_DB - ampToDb(peak));
  const g = dbToAmp(gainDb);
  for (let i = 0; i < samples.length; i++) samples[i] *= g;
  return { rmsBeforeDb: ampToDb(rms), rmsAfterDb: ampToDb(rms * g), peakAfterDb: ampToDb(peak * g), gainDb };
}

function fade(samples: Float32Array, rate: number) {
  const n = Math.min(Math.round((FADE_MS / 1000) * rate), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    samples[i] *= k;
    samples[samples.length - 1 - i] *= k;
  }
}

/** Steps 1-4 for one recording. */
export async function processClip(clip: Clip, trim: { start: number; end: number }): Promise<{ samples: Float32Array; report: LevelReport }> {
  const out = await filterAndResample(clip, trim.start, trim.end);
  const report = level(out, OUT_RATE);
  fade(out, OUT_RATE);
  return { samples: out, report };
}

/** Steps 5-6: intro, 400 ms, the listener, 400 ms, outro; padded to whole seconds; as a WAV. */
export function assemble(parts: { intro?: Float32Array | null; voice: Float32Array; outro?: Float32Array | null }): { wav: Blob; seconds: number } {
  const gap = Math.round((GAP_MS / 1000) * OUT_RATE);
  const pieces: (Float32Array | number)[] = [];
  if (parts.intro?.length) pieces.push(parts.intro, gap);
  pieces.push(parts.voice);
  if (parts.outro?.length) pieces.push(gap, parts.outro);
  const raw = pieces.reduce<number>((n, p) => n + (typeof p === "number" ? p : p.length), 0);
  const total = Math.ceil(raw / OUT_RATE) * OUT_RATE;
  const out = new Float32Array(total);
  let o = 0;
  for (const p of pieces) {
    if (typeof p === "number") o += p;
    else {
      out.set(p, o);
      o += p.length;
    }
  }
  return { wav: new Blob([encodeWav(out, OUT_RATE)], { type: "audio/wav" }), seconds: total / OUT_RATE };
}
