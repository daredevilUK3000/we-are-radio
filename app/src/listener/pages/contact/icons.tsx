/** Line icons for the contact page (the Top 3 page's set, plus a few of its own). All decorative. */
export { IconArrow, IconCheck, IconMail, IconMusic, IconTrophy } from "../../components/contest/enter/icons";

type P = { size?: number; className?: string };
const svg = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
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

export const IconMic = ({ size = 22, className }: P) =>
  svg(size, className, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>);
export const IconBriefcase = ({ size = 22, className }: P) =>
  svg(size, className, <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18" /></>);
export const IconNews = ({ size = 22, className }: P) =>
  svg(size, className, <><path d="M5 4h12a1 1 0 0 1 1 1v14a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z" /><path d="M18 8h2v10a2 2 0 0 1-2 2M8 8h6M8 12h6M8 16h4" /></>);
export const IconWrench = ({ size = 22, className }: P) =>
  svg(size, className, <path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.8 1.9L6 21.7a2 2 0 0 1-2.8-2.8l7.2-7.2A6 6 0 0 1 12.3 3.9l1.3 1.3a4 4 0 0 0 1.1 1.1z" />);
export const IconSend = ({ size = 18, className }: P) =>
  svg(size, className, <><path d="M21 3 10 14" /><path d="M21 3l-7 18-4-7-7-4 18-7z" /></>);
export const IconCopy = ({ size = 16, className }: P) =>
  svg(size, className, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const IconShare = ({ size = 18, className }: P) =>
  svg(size, className, <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>);
