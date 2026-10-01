import { useState, type ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { channelAccent } from "../listener/lib/channelAccent";
import { clockText, dateText, stillFor, useNow } from "./tvData";

/** Clock over the date, top right of every screen (the TV's own time). */
export function TvClock({ big = false }: { big?: boolean }) {
  const now = useNow(1000);
  return (
    <div className={`tv-clock${big ? " is-big" : ""}`}>
      <div className="tv-clock-time">{clockText(now)}</div>
      <div className="tv-clock-date">{dateText(now)}</div>
    </div>
  );
}

export function OnAirPill({ label = "On air" }: { label?: string }) {
  return (
    <span className="tv-onair">
      <span className="tv-onair-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EqBars({ still = false }: { still?: boolean }) {
  return (
    <span className={`tv-eq${still ? " is-still" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** A focusable pill button (primary or secondary). */
export function TvButton({
  focusKey,
  children,
  onPress,
  primary = false,
  className = "",
  onFocus,
}: {
  focusKey?: string;
  children: ReactNode;
  onPress: () => void;
  primary?: boolean;
  className?: string;
  onFocus?: () => void;
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onPress, onFocus: onFocus ? () => onFocus() : undefined });
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      className={`tv-pill${primary ? " is-primary" : ""}${focused ? " is-focused" : ""} ${className}`}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/** A round control with its label underneath (Now Playing). */
export function RoundControl({
  focusKey,
  label,
  icon,
  size = 100,
  onPress,
  active = false,
  onArrowPress,
}: {
  focusKey?: string;
  label: string;
  icon: ReactNode;
  size?: number;
  onPress: () => void;
  active?: boolean;
  onArrowPress?: (direction: string) => boolean;
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress: onArrowPress ? (dir) => onArrowPress(dir) : undefined,
  });
  return (
    <div className="tv-round-wrap">
      <button
        ref={ref}
        type="button"
        tabIndex={-1}
        aria-label={label}
        className={`tv-round${focused ? " is-focused" : ""}${active ? " is-active" : ""}`}
        style={{ width: size, height: size }}
        onClick={onPress}
      >
        {icon}
      </button>
      <span className="tv-round-label">{label}</span>
    </div>
  );
}

/** A channel's still, or its accent colour with the logo when there's none. */
export function ChannelStill({ slug, className = "", blur = false }: { slug: string; className?: string; blur?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`tv-still-fallback ${className}`} style={{ background: `linear-gradient(135deg, ${channelAccent(slug)}, #08080a 80%)` }}>
        <img src="/weareradio-logo-hero.webp" alt="" />
      </div>
    );
  }
  return <img className={`${className}${blur ? " is-blurred" : ""}`} src={stillFor(slug)} alt="" onError={() => setFailed(true)} />;
}

export function HintBar({ items }: { items: [string, string][] }) {
  return (
    <div className="tv-hints" aria-hidden="true">
      {items.map(([key, text]) => (
        <span key={key + text}>
          <kbd>{key}</kbd> {text}
        </span>
      ))}
    </div>
  );
}

// Icons, drawn to the canvas's weights.
export const Icon = {
  play: <svg viewBox="0 0 24 24" width="44%" height="44%"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>,
  pause: (
    <svg viewBox="0 0 24 24" width="40%" height="40%">
      <rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor" />
    </svg>
  ),
  restart: (
    <svg viewBox="0 0 24 24" width="44%" height="44%" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  ),
  heart: (filled: boolean) => (
    <svg viewBox="0 0 24 24" width="44%" height="44%" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2">
      <path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20z" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" width="42%" height="42%" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  mic: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="40%" height="40%" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
};
