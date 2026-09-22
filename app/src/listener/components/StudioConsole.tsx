import { useMemo } from "react";
import { CHANNEL_AMBER } from "../lib/channelAccent";

const BAR_COUNT = 58;
const PATTERNS = ["lp-console-1", "lp-console-2", "lp-console-3"];

// mulberry32 - small, fast, seedable: gives the console strip a bar layout
// that's stable for a given channel (not reshuffling on every re-render)
// but different from one channel to the next.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The "presenter's console" meter strip: a wide bank of independently
 * animating bars, mixing a few sway patterns/durations so it reads as a
 * genuine multi-channel meter bank rather than one loop repeating. Purely
 * decorative (aria-hidden) - it doesn't sync to the actual audio.
 */
export function StudioConsole({ accent, seed }: { accent: string; seed: string }) {
  const bars = useMemo(() => {
    const rand = mulberry32(hash(seed) || 1);
    return Array.from({ length: BAR_COUNT }, () => ({
      pattern: PATTERNS[Math.floor(rand() * PATTERNS.length)],
      duration: 0.9 + rand() * 1.3,
      delay: rand() * 2,
      color: rand() < 0.22 ? CHANNEL_AMBER : accent,
      opacity: rand() < 0.55 ? 1 : 0.55,
    }));
  }, [seed, accent]);

  return (
    <div className="lp-console">
      <div className="lp-console-head">
        <span className="lp-console-label">Studio Console</span>
        <span className="lp-console-live">
          <span className="lp-console-live-dot" /> Live
        </span>
      </div>
      <div className="lp-console-strip" aria-hidden="true">
        {bars.map((bar, i) => (
          <span
            key={i}
            className={bar.pattern}
            style={{
              background: bar.color,
              opacity: bar.opacity,
              animationDuration: `${bar.duration}s`,
              animationDelay: `${bar.delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
