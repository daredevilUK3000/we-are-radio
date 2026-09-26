import { useState } from "react";
import { IconStar } from "./icons";

/**
 * The prize panel. The wording follows rules section 11: the interview and
 * the compilation are offers there ("an interview opportunity", "an offer to
 * include the song"), so they're worded as offers here too, never promises.
 */
const PRIZES = [
  "Official recognition as one of We Are Radio's Top 3 Creator Songs of 2026",
  "A featured broadcast of your song on We Are Radio",
  "An interview opportunity on Kizzi's Friday Game Changers",
  "An offer to include your song on the We Are Radio Creator Songs 2026 compilation",
  "A winner profile on weareradio.app",
  "Promotion across We Are Radio's social channels",
  "A digital winner's certificate and trophy",
];
const PHONE_PREVIEW = 4;

// Two gold laurel branches rising from the bottom around the "3", open at
// the top, plus two faint rings. Leaves sit in pairs along each branch.
const CX = 200;
const CY = 200;
const R = 148;
const rad = (d: number) => (d * Math.PI) / 180;
const at = (deg: number, r = R) => ({ x: CX + r * Math.cos(rad(deg)), y: CY - r * Math.sin(rad(deg)) });

function branch(from: number, to: number) {
  const steps = 9;
  const pts = Array.from({ length: steps }, (_, i) => from + ((to - from) * i) / (steps - 1));
  const stem = pts.map((d, i) => `${i ? "L" : "M"}${at(d).x.toFixed(1)} ${at(d).y.toFixed(1)}`).join(" ");
  const dir = Math.sign(to - from); // which way the branch grows round the circle
  const leaves = pts.slice(0, -1).flatMap((d, i) => {
    // The branch's direction of travel at this point, in screen degrees.
    const heading = (Math.atan2(-Math.cos(rad(d)) * dir, -Math.sin(rad(d)) * dir) * 180) / Math.PI;
    const size = 1 - i * 0.05;
    return [-1, 1].map((side) => {
      const p = at(d, R + side * 11);
      const rot = heading + 90 + side * 32;
      return (
        <ellipse key={`${d}-${side}`} cx={p.x} cy={p.y} rx={7 * size} ry={19 * size} transform={`rotate(${rot.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})`} />
      );
    });
  });
  return { stem, leaves };
}

/** The laurel; `prefix` picks the stylesheet's classes (t3p on the entry page, t3f on the homepage band). */
export function Laurel({ prefix = "t3p", rings = true }: { prefix?: string; rings?: boolean }) {
  const left = branch(252, 128);
  const right = branch(288, 412); // up the right-hand side, through 0°
  return (
    <svg className={`${prefix}-laurel`} viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      {rings && (
        <>
          <circle cx={CX} cy={CY} r="186" className={`${prefix}-laurel-ring`} />
          <circle cx={CX} cy={CY} r="112" className={`${prefix}-laurel-ring`} />
        </>
      )}
      <path d={left.stem} className={`${prefix}-laurel-stem`} />
      <path d={right.stem} className={`${prefix}-laurel-stem`} />
      <g className={`${prefix}-laurel-leaves`}>
        {left.leaves}
        {right.leaves}
      </g>
    </svg>
  );
}

export function PrizePackage() {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="t3p-prize" aria-labelledby="t3p-prize-title">
      <div className="t3p-prize-art" aria-hidden="true">
        <Laurel />
        <span className="t3p-prize-3 t3p-sheen">3</span>
        <span className="t3p-prize-winners">Winners · 2026</span>
      </div>
      <div className="t3p-prize-body">
        <span className="t3p-eyebrow t3p-eyebrow-gold">The prize</span>
        <h2 id="t3p-prize-title" className="t3p-h2 t3p-prize-h2">
          The Creator's <br />
          Breakthrough Package
        </h2>
        <p className="t3p-prize-intro">
          Each of the Top 3 receives recognition, airplay and an audience: the things that move a creator forward.
        </p>
        <ul className={`t3p-prize-list${expanded ? " is-expanded" : ""}`} id="t3p-prize-list">
          {PRIZES.map((p, i) => (
            <li key={p} className={i >= PHONE_PREVIEW ? "t3p-prize-extra" : undefined}>
              <IconStar className="t3p-gold-icon" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="t3p-prize-more"
          aria-expanded={expanded}
          aria-controls="t3p-prize-list"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show less" : "See the full package"}
        </button>
        <p className="t3p-prize-foot">Partner prizes, if any, will be announced before the final round.</p>
      </div>
    </section>
  );
}
