export function BrandMark() {
  return (
    <svg className="listener-logo-mark" width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="2.4" />
      <circle cx="12" cy="12" r="6" strokeWidth="1.6" fill="none" />
      <circle cx="12" cy="12" r="10" strokeWidth="1.6" fill="none" opacity="0.6" />
    </svg>
  );
}

export function EyebrowPill({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`eyebrow-pill${className ? ` ${className}` : ""}`}>
      <span className="eyebrow-dot" />
      {label}
    </span>
  );
}
