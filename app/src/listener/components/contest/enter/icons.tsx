/** Small line icons for the Top 3 entry page. All decorative (aria-hidden). */

type P = { size?: number; className?: string };
const svg = (size: number, className: string | undefined, children: React.ReactNode, fill = "none") => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const IconPlay = ({ size = 18, className }: P) =>
  svg(size, className, <path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5z" stroke="none" />, "currentColor");
export const IconPause = ({ size = 18, className }: P) =>
  svg(size, className, <><rect x="6" y="4.5" width="4" height="15" rx="1" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" stroke="none" /></>, "currentColor");
export const IconGlobe = ({ size = 14, className }: P) =>
  svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>);
export const IconUpload = ({ size = 28, className }: P) =>
  svg(size, className, <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
export const IconMusic = ({ size = 22, className }: P) =>
  svg(size, className, <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>);
export const IconCamera = ({ size = 26, className }: P) =>
  svg(size, className, <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>);
export const IconLock = ({ size = 18, className }: P) =>
  svg(size, className, <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const IconMail = ({ size = 34, className }: P) =>
  svg(size, className, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5 12 13l8.5-6.5" /></>);
export const IconCheck = ({ size = 14, className }: P) => svg(size, className, <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconWarn = ({ size = 14, className }: P) =>
  svg(size, className, <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>);
export const IconStar = ({ size = 18, className }: P) =>
  svg(size, className, <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" />);
export const IconTrophy = ({ size = 26, className }: P) =>
  svg(size, className, <><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" /></>);
export const IconClock = ({ size = 18, className }: P) => svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconShield = ({ size = 18, className }: P) =>
  svg(size, className, <><path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-3z" /><path d="m9 12 2 2 4-4" /></>);
export const IconDoc = ({ size = 18, className }: P) =>
  svg(size, className, <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>);
export const IconArrow = ({ size = 18, className }: P) => svg(size, className, <path d="M5 12h14M13 6l6 6-6 6" />);
export const IconClose = ({ size = 16, className }: P) => svg(size, className, <path d="M6 6l12 12M18 6 6 18" />);

/** Four little bouncing bars - "this is playing". */
export function PlayingBars({ className = "" }: { className?: string }) {
  return (
    <span className={`t3p-bars ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
