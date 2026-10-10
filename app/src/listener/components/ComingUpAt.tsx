import { useEffect, useState } from "react";

/**
 * "Coming up at 18:00: Friday Game Changers" - a public block starting within
 * the hour on this channel (now-playing's next_block, from the log, so a
 * moved start shows as moved), in the listener's own time.
 */
export function ComingUpAt({ block, className = "" }: { block?: { name: string; description?: string; starts_at: number } | null; className?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!block) return null;
  const at = block.starts_at * 1000;
  if (at <= now || at - now > 60 * 60_000) return null;
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  return (
    <p className={`coming-up-at ${className}`.trim()}>
      <span className="coming-up-at-dot" aria-hidden="true" />
      <span>
        Coming up at <time dateTime={new Date(at).toISOString()}>{time}</time>: <strong>{block.name}</strong>
      </span>
    </p>
  );
}
