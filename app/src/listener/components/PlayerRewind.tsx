import { behindLabel } from "../lib/useRewind";
import "./playerExtras.css";

/** ↺ Start over: shown only when it can be used (a song, playing, 10 s in, not casting, not a contest entry during voting). */
export function StartOverButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`so-btn ${className}`} onClick={onClick} title="Hear this song again from the start">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
      </svg>
      Start over
    </button>
  );
}

/** "● Back to live · 2:41 behind": the only way back early from a replay. */
export function BackToLivePill({ behindSeconds, onClick, compact = false }: { behindSeconds: number; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" className={`so-live${compact ? " is-compact" : ""}`} onClick={onClick}>
      <span className="so-live-dot" aria-hidden="true" />
      Back to live
      {!compact && behindSeconds >= 1 && <span className="so-behind">{behindLabel(behindSeconds)} behind</span>}
    </button>
  );
}
