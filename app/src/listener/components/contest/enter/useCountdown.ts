import { useEffect, useState } from "react";

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

function remaining(targetMs: number): Countdown {
  const ms = Math.max(0, targetMs - Date.now());
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    done: ms === 0,
  };
}

/** Time left until an ISO instant, ticking once a second and stopping at zero. */
export function useCountdown(targetIso: string | null | undefined): Countdown | null {
  const target = targetIso ? Date.parse(targetIso) : NaN;
  const [left, setLeft] = useState<Countdown | null>(() => (Number.isFinite(target) ? remaining(target) : null));

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setLeft(null);
      return;
    }
    setLeft(remaining(target));
    const id = window.setInterval(() => {
      const next = remaining(target);
      setLeft(next);
      if (next.done) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  return left;
}
