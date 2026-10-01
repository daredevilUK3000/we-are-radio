import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { SayItOnAir, MicIcon, type OnAirNowPlaying } from "./SayItOnAir";

/** The round shout-out button next to share and like in the players (wording chosen by Kizzi, 1 Oct 2026). */
export function SayItOnAirButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`oa-open-btn ${className}`} onClick={onClick}>
      <span className="oa-open-icon" aria-hidden="true">
        <MicIcon size={16} />
      </span>
      Click here to send a shout out. Spread the love.
    </button>
  );
}

/** The recorder as a bottom sheet over the player. Closing it mid-recording stops and discards the take. */
export function OnAirSheet({ channelSlug, nowPlaying, onClose }: { channelSlug: string; nowPlaying: OnAirNowPlaying | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="oa-sheet-overlay" role="dialog" aria-modal="true" aria-label="Send a shout out" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="oa-sheet">
        <header className="oa-sheet-top">
          <div>
            <div className="oa-eyebrow">Send a shout out</div>
            <div className="oa-sheet-title">Your voice. On the radio.</div>
          </div>
          <button ref={closeRef} type="button" className="oa-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <SayItOnAir channelSlug={channelSlug} nowPlaying={nowPlaying} variant="sheet" onClose={onClose} />
        <p className="oa-sheet-foot">
          <Link to="/on-air" onClick={onClose}>
            How it works
          </Link>
        </p>
      </div>
    </div>,
    document.body
  );
}
