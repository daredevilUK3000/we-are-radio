import { useEffect, useRef, useState } from "react";

/**
 * Video helpers for the Top 3 entry page, which has up to six looping clips.
 *
 * - "Lite" visitors - reduced motion, or the browser's data saver - get the
 *   poster still instead of any video (the stylesheet also stops every
 *   animation for reduced motion).
 * - Every clip pauses while it's off-screen and resumes when it's back.
 */

const liteMedia = (() => {
  if (typeof window === "undefined") return false;
  const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return reduced || saveData;
})();

export const useLiteMedia = () => liteMedia;

/** True at desktop widths (checked once, at mount - enough to decide whether to request the tile videos at all). */
export function useIsDesktop(minWidth = 1024) {
  const [desktop] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(`(min-width: ${minWidth}px)`).matches);
  return desktop;
}

export function LoopVideo({
  src,
  poster,
  className,
  preload = "metadata",
  lazy = false,
}: {
  src: string;
  poster: string;
  className?: string;
  preload?: "auto" | "metadata" | "none";
  /** Don't give the video its source until it first scrolls into view (autoplay ignores preload="none"). */
  lazy?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const lite = useLiteMedia();
  const [seen, setSeen] = useState(!lazy);

  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          video.play().catch(() => {});
        }
        else video.pause();
      },
      { threshold: 0.05 }
    );
    io.observe(video);
    return () => io.disconnect();
  }, [lite]);

  if (lite) return <img className={className} src={poster} alt="" aria-hidden="true" />;
  return (
    <video
      ref={ref}
      className={className}
      src={seen ? src : undefined}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload={preload}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
