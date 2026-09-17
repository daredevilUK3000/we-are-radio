function EqBars({ count, seed = 0 }: { count: number; seed?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="eq-bar"
          style={{
            animationDuration: `${1.6 + ((i + seed) % 5) * 0.22}s`,
            animationDelay: `${((i + seed) % 7) * 0.15}s`,
          }}
        />
      ))}
    </>
  );
}

// Purely decorative animated backdrop for the Home hero - blurred wide
// equalizer bars, a tighter masked layer in front, three pulsing broadcast
// rings, and a slow-rotating tuning dial. All CSS-driven (see global.css),
// no video/canvas, so it's cheap to keep running behind real hero footage
// once that's sourced (handoff: explicitly deferred, not thrown away later).
export function HeroBackdrop() {
  return (
    <div className="hero-backdrop" aria-hidden="true">
      <div className="eq-layer eq-layer-far">
        <EqBars count={26} />
      </div>
      <div className="eq-layer eq-layer-near">
        <EqBars count={16} seed={3} />
      </div>
      <div className="broadcast-rings">
        <span className="broadcast-ring" />
        <span className="broadcast-ring" />
        <span className="broadcast-ring" />
      </div>
      <svg className="tuning-dial" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="1" />
        {Array.from({ length: 24 }, (_, i) => {
          const angle = (i / 24) * 360;
          return (
            <line
              key={i}
              x1="50"
              y1="6"
              x2="50"
              y2="12"
              stroke="currentColor"
              strokeWidth="1"
              transform={`rotate(${angle} 50 50)`}
            />
          );
        })}
        <line x1="50" y1="50" x2="50" y2="14" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function ProgrammeEqSilhouette() {
  return (
    <div className="programme-eq-silhouette" aria-hidden="true">
      <EqBars count={20} seed={1} />
    </div>
  );
}
