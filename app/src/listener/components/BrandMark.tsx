export function EyebrowPill({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`eyebrow-pill${className ? ` ${className}` : ""}`}>
      <span className="eyebrow-dot" />
      {label}
    </span>
  );
}
