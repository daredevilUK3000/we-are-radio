import { useState } from "react";
import { Link } from "react-router-dom";
import { downloadFraction, offlineSupported, useDownloadProgress, useOfflineBlocks } from "../../shared/offline";

const SEEN_KEY = "we-are-radio:download-button-seen";

/**
 * The mini-player's "download for offline" button - on every page, so
 * listeners come across offline listening without looking for it. Shows the
 * state at a glance: an arrow, a filling ring while a download runs, a tick
 * once this channel is downloaded. It pulses gently until it's first tapped.
 * Tapping opens the Offline page on this channel.
 */
export function DownloadButton({ channelSlug }: { channelSlug: string }) {
  const progress = useDownloadProgress();
  const blocks = useOfflineBlocks();
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return true;
    }
  });

  if (!offlineSupported) return null;

  const downloading = !!progress && !progress.finished;
  const fraction = downloading ? downloadFraction(progress) : 0;
  const downloaded = !!blocks?.some((b) => b.channelSlug === channelSlug);
  const label = downloading
    ? `Downloading for offline - ${Math.round(fraction * 100)}%`
    : downloaded
      ? "Downloaded for offline listening"
      : "Download to listen offline";

  const markSeen = () => {
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // it just pulses again next visit
    }
  };

  const r = 15;
  const circumference = 2 * Math.PI * r;

  return (
    <Link
      to={`/offline?channel=${channelSlug}`}
      className={`mp-dl-btn${downloaded ? " is-done" : ""}${!seen && !downloaded ? " is-new" : ""}`}
      onClick={markSeen}
      aria-label={label}
      title={label}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="mp-dl-track" />
        {downloading && (
          <circle
            cx="18"
            cy="18"
            r={r}
            className="mp-dl-ring"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            transform="rotate(-90 18 18)"
          />
        )}
        {downloaded && !downloading ? (
          <path d="M12 18.5l4 4 8-9" className="mp-dl-glyph" />
        ) : (
          <>
            <path d="M18 10v12" className="mp-dl-glyph" />
            <path d="M13 17.5l5 5 5-5" className="mp-dl-glyph" />
            <path d="M12 26h12" className="mp-dl-glyph" />
          </>
        )}
      </svg>
    </Link>
  );
}
