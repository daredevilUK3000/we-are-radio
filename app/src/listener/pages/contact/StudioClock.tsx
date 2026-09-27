import { useStationBridge } from "../../components/contest/enter/useStationBridge";
import { useStudioTime } from "./useStudioTime";
import { CONTACT_EMAIL } from "./topics";

/**
 * The studio's local time (Limoges) and what's on air. On a phone it shrinks
 * to the digital time and the email address.
 */
export function StudioClock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  const time = useStudioTime();
  const station = useStationBridge();

  const hour = (time.h % 12) * 30 + time.m * 0.5;
  const minute = time.m * 6 + time.s * 0.1;
  const second = time.s * 6;

  return (
    <div className={`c3p-clock ${className}`} style={style}>
      <svg className="c3p-clock-face" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
        <circle cx="28" cy="28" r="26" className="c3p-clock-ring" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="28" y1="4.5" x2="28" y2={i % 3 === 0 ? 9 : 7.5} className="c3p-clock-tick" transform={`rotate(${i * 30} 28 28)`} />
        ))}
        <line x1="28" y1="28" x2="28" y2="15" className="c3p-clock-hour" transform={`rotate(${hour} 28 28)`} />
        <line x1="28" y1="28" x2="28" y2="9" className="c3p-clock-min" transform={`rotate(${minute} 28 28)`} />
        <line x1="28" y1="32" x2="28" y2="7" className="c3p-clock-sec" transform={`rotate(${second} 28 28)`} />
        <circle cx="28" cy="28" r="2.4" className="c3p-clock-pin" />
      </svg>

      <div className="c3p-clock-time">
        <span className="c3p-clock-label">In the studio · Limoges, France</span>
        <span className="c3p-clock-digits">
          <time>{time.text}</time> <span className="c3p-clock-zone">{time.zone}</span>
        </span>
      </div>

      {station.onAir && station.channelName && (
        <div className="c3p-clock-now">
          <span className="c3p-clock-label">Now playing</span>
          <span className="c3p-clock-channel">
            <span className="c3p-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {station.channelName}
          </span>
        </div>
      )}

      <a className="c3p-clock-mail" href={`mailto:${CONTACT_EMAIL}`}>
        {CONTACT_EMAIL}
      </a>
    </div>
  );
}
