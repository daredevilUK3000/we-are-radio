const SEGMENTS = 24;

/**
 * A VU meter that fills as the message grows: one segment per 12 characters.
 * Decorative - the real, readable count is the text beside it, which the
 * textarea points to with aria-describedby.
 */
export function LevelMeter({ length, max, countId }: { length: number; max: number; countId: string }) {
  const lit = Math.min(SEGMENTS, Math.ceil(length / 12));
  return (
    <div className="c3p-meter">
      <span className="c3p-meter-label" aria-hidden="true">
        Level
      </span>
      <span className="c3p-meter-bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const zone = i < 15 ? "g" : i < 20 ? "a" : "r";
          return <i key={i} className={i < lit ? `on ${zone}` : undefined} />;
        })}
      </span>
      <span id={countId} className="c3p-meter-count">
        {length} / {max}
        <span className="c3p-sr"> characters</span>
      </span>
    </div>
  );
}
