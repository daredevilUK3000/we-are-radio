import { countryName } from "../../../../shared/countries";
import { LoopVideo, useIsDesktop } from "./media";
import { IconPlay } from "./icons";

/**
 * A live mock-up of the song page the entrant will get once approved,
 * filling in as they type. Everything in it is a picture, not a control.
 */
function waveHeights(count: number, seed: number): number[] {
  // Deterministic pseudo-random heights: stable for the same seed.
  let x = seed % 2147483647 || 7;
  return Array.from({ length: count }, (_, i) => {
    x = (x * 48271) % 2147483647;
    const wave = 0.5 + 0.35 * Math.sin(i / 3.1) + 0.15 * Math.sin(i / 1.3);
    return Math.max(0.12, Math.min(1, wave * (0.55 + (x % 1000) / 2200)));
  });
}

export function MiniWave({ count, seed, className }: { count: number; seed: number; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {waveHeights(count, seed).map((h, i) => (
        <i key={i} style={{ height: `${Math.round(h * 100)}%` }} />
      ))}
    </span>
  );
}

export function SongPagePreview({
  title,
  creator,
  countryCode,
  photoUrl,
  votingOpenLabel,
}: {
  title: string;
  creator: string;
  countryCode: string;
  photoUrl: string | null;
  votingOpenLabel: string;
}) {
  const desktop = useIsDesktop();
  return (
    <div className="t3p-preview-wrap">
      <span className="t3p-aside-label">Your song page · Live preview</span>
      <div className="t3p-preview" aria-label="Preview of your song page">
        <div className="t3p-preview-media">
          {photoUrl ? (
            <img src={photoUrl} alt="" />
          ) : desktop ? (
            <LoopVideo className="t3p-preview-video" src="/top3/top3-card-studio.mp4" poster="/top3/top3-card-studio.jpg" />
          ) : (
            <img className="t3p-preview-video" src="/top3/top3-card-studio.jpg" alt="" aria-hidden="true" />
          )}
          <span className="t3p-preview-num" title="Your song number is given when your entry is approved">
            Song #—
          </span>
          <span className="t3p-preview-badge">In the running</span>
        </div>
        <div className="t3p-preview-body">
          <strong className="t3p-preview-title">{title.trim() || "Your song title"}</strong>
          <span className="t3p-preview-sub">
            {creator.trim() || "Your creator name"} · {countryCode ? countryName(countryCode) : "Your country"}
          </span>
          <div className="t3p-preview-player" aria-hidden="true">
            <span className="t3p-preview-play">
              <IconPlay size={18} />
            </span>
            <MiniWave count={34} seed={title.length * 31 + creator.length * 7 + 11} className="t3p-wave t3p-wave-small" />
          </div>
          <div className="t3p-preview-actions" aria-hidden="true">
            <span>♡ Like</span>
            <span>↗ Share</span>
          </div>
        </div>
      </div>
      <p className="t3p-aside-note">Once approved, this is the page you share with fans. Voting opens {votingOpenLabel}.</p>
    </div>
  );
}
