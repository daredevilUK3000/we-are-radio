import { LoopVideo, useLiteMedia } from "../../components/contest/enter/media";
import { StudioClock } from "./StudioClock";
import { useCopyEmail } from "./useCopy";
import { CONTACT_EMAIL } from "./topics";
import { IconMail } from "./icons";

/**
 * Two sine waves with a slowly drifting amplitude, so the scope looks like a
 * live signal. Each path covers two identical widths; the CSS slides it left
 * by one width and loops, so the join never shows. Built once, not per frame.
 */
function wavePath(periods: number, amplitude: number, wobble: number, seed: number) {
  const W = 1000;
  const H = 90;
  const points: string[] = [];
  for (let x = 0; x <= W * 2; x += 4) {
    const t = x / W; // 0..2, periodic in 1
    const envelope = 1 - wobble + wobble * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t * 2 + seed)));
    const jitter = 0.12 * Math.sin(2 * Math.PI * (t * 7 + seed * 3));
    const y = H / 2 + (amplitude * envelope + amplitude * jitter * 0.4) * Math.sin(2 * Math.PI * periods * t);
    points.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`);
  }
  return points.join(" ");
}
const RED_WAVE = wavePath(3, 30, 0.45, 0.1);
const WHITE_WAVE = wavePath(5, 18, 0.55, 0.6);

function Oscilloscope() {
  return (
    <div className="c3p-scope" aria-hidden="true">
      <svg className="c3p-scope-wave c3p-scope-red" viewBox="0 0 2000 90" preserveAspectRatio="none" focusable="false">
        <path d={RED_WAVE} vectorEffect="non-scaling-stroke" />
      </svg>
      <svg className="c3p-scope-wave c3p-scope-white" viewBox="0 0 2000 90" preserveAspectRatio="none" focusable="false">
        <path d={WHITE_WAVE} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function ContactHero({ onSendMessage }: { onSendMessage: () => void }) {
  const { copied, copyOrMail } = useCopyEmail(CONTACT_EMAIL);
  const lite = useLiteMedia();

  return (
    <section className="c3p-hero" aria-labelledby="c3p-title">
      <div className="c3p-hero-bg" aria-hidden="true">
        <div className="c3p-hero-glow" />
        <div className="c3p-hero-grid" />
      </div>

      <div className="c3p-hero-copy">
        <div className="c3p-eyebrow-row c3p-rise" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="c3p-open-pill">
            <i className="c3p-blink" aria-hidden="true" />
            The lines are open
          </span>
          <span className="c3p-eyebrow-note">Every message is read in the studio</span>
        </div>

        <h1 id="c3p-title" className="c3p-h1 c3p-rise" style={{ "--i": 1 } as React.CSSProperties}>
          <span className="c3p-h1-line">Talk to</span> <span className="c3p-h1-line">
            the <span className="c3p-red">studio.</span>
          </span>
        </h1>

        <p className="c3p-lede c3p-rise" style={{ "--i": 2 } as React.CSSProperties}>
          Requests, dedications, ideas, questions, business.{" "}
          <span className="c3p-wide-only">Whatever it is, pick up the line. Your message goes straight to the studio desk in Limoges.</span>
          <span className="c3p-phone-only">Pick up the line.</span>
        </p>

        <div className="c3p-hero-btns c3p-rise" style={{ "--i": 3 } as React.CSSProperties}>
          <button type="button" className="c3p-btn c3p-btn-red c3p-btn-lg" onClick={onSendMessage}>
            Send a message <span aria-hidden="true">↓</span>
          </button>
          <a className="c3p-btn c3p-btn-ghost c3p-btn-lg c3p-email-btn" href={`mailto:${CONTACT_EMAIL}`} onClick={copyOrMail}>
            <IconMail size={18} />
            <span>{copied ? "Email address copied" : CONTACT_EMAIL}</span>
          </a>
          <span className="c3p-sr" role="status">
            {copied ? "Email address copied" : ""}
          </span>
        </div>

        <StudioClock className="c3p-rise" style={{ "--i": 4 } as React.CSSProperties} />
      </div>
      <div className="c3p-portal-wrap">
        <div className="c3p-rings" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="c3p-portal">
          <LoopVideo
            className="c3p-portal-video"
            src="/hero-video.mp4"
            poster="/hero-video-poster.jpg"
            preload={lite ? "none" : "auto"}
          />
          <div className="c3p-portal-shade" aria-hidden="true" />
          <Oscilloscope />
          <div className="c3p-portal-caption">
            <p className="c3p-portal-title">Straight to the studio desk</p>
            <p className="c3p-portal-text">
              <span className="c3p-wide-only">No call centre, no bots. </span>A real person reads every message.
            </p>
          </div>
        </div>
        <div className="c3p-lamp" aria-hidden="true">
          <span>ON AIR</span>
        </div>
      </div>

    </section>
  );
}
