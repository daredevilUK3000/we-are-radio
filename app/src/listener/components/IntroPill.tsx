import { INTRO_LABEL } from "../../shared/intro";
import "./IntroPill.css";

/** "Intro" while a song's spoken intro plays (shared/intro.ts): sits where "Now Playing" or the voice pill does. */
export function IntroPill({ className = "" }: { className?: string }) {
  return (
    <span className={`intro-pill ${className}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
      </svg>
      {INTRO_LABEL}
    </span>
  );
}
