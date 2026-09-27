import { useEffect, useState } from "react";

/**
 * The time in the studio (Limoges, so Europe/Paris), ticking once a second
 * on the second. Stops while the tab is hidden and catches up on return.
 */
export interface StudioTime {
  h: number;
  m: number;
  s: number;
  /** "HH:MM:SS" */
  text: string;
  /** "CEST" in summer, "CET" in winter. */
  zone: string;
}

const clockParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const zoneName = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "short" });

// Some browsers name the zone "GMT+1" / "GMT+2" rather than CET / CEST.
const ZONE_FALLBACK: Record<string, string> = { "GMT+1": "CET", "GMT+2": "CEST", "UTC+1": "CET", "UTC+2": "CEST" };

export function studioTimeAt(date: Date): StudioTime {
  const parts = clockParts.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  const raw = zoneName.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return { h, m, s, text: `${pad(h)}:${pad(m)}:${pad(s)}`, zone: ZONE_FALLBACK[raw] ?? raw };
}

export function useStudioTime(): StudioTime {
  const [time, setTime] = useState(() => studioTimeAt(new Date()));

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const now = new Date();
      setTime(studioTimeAt(now));
      timer = window.setTimeout(tick, 1000 - now.getMilliseconds() + 5);
    };
    const start = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") tick();
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return time;
}
