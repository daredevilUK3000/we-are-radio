import { IconTrophy } from "./icons";

/** "The road to the Top 3": the four stages, with "You are here" on the current one. */
const STAGES = [
  {
    title: "Enter",
    date: "1 Oct 2026 – 31 Mar 2027",
    text: "Upload one song you created or released in 2026. Every entry is listened to and reviewed within 14 days.",
  },
  {
    title: "Get heard",
    date: "From October 2026",
    text: "Approved songs get a page to share with fans, and can be featured on the weekly Creator Spotlight Show.",
  },
  {
    title: "The world votes",
    date: "April – July 2027",
    text: "Four rounds of public voting: every song, then the Top 100, the Top 50 and the Top 20.",
  },
  {
    title: "Top 3 crowned",
    date: "September 2027",
    text: "The public vote and a judging panel decide the winners, revealed on a live countdown show on We Are Radio.",
  },
];

export function RoadToTop3({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <section className="t3p-road" aria-labelledby="t3p-road-title">
      <div className="t3p-section-head">
        <div>
          <span className="t3p-eyebrow t3p-eyebrow-red">How it works</span>
          <h2 id="t3p-road-title" className="t3p-h2">
            The road to the Top 3
          </h2>
        </div>
        <p className="t3p-section-intro">
          Four stages, one year. Every approved song gets its own page, a shot at airplay, and a place in the public vote.
        </p>
      </div>

      <ol className="t3p-road-list">
        {STAGES.map((s, i) => {
          const n = i + 1;
          const isCurrent = n === current;
          const isFinal = n === STAGES.length;
          return (
            <li
              key={s.title}
              className={`t3p-stage${isCurrent ? " is-current" : ""}${isFinal ? " is-final" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="t3p-stage-num" aria-hidden="true">
                {isFinal ? <IconTrophy /> : String(n).padStart(2, "0")}
              </span>
              <div className="t3p-stage-card">
                <div className="t3p-stage-top">
                  <h3 className={isFinal ? "t3p-sheen" : undefined}>{s.title}</h3>
                  {isCurrent && <span className="t3p-here">You are here</span>}
                </div>
                <span className="t3p-stage-date">{s.date}</span>
                <p>{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
