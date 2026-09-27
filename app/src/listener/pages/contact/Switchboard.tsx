import { useRef } from "react";
import { TOPICS, lineLabel, type TopicKey } from "./topics";
import { IconBriefcase, IconMic, IconMusic, IconNews, IconTrophy, IconWrench } from "./icons";

const ICONS: Record<TopicKey, React.ReactNode> = {
  studio: <IconMic size={26} />,
  request: <IconMusic size={26} />,
  top3: <IconTrophy size={26} className="c3p-gold-icon" />,
  business: <IconBriefcase size={26} />,
  press: <IconNews size={26} />,
  problem: <IconWrench size={26} />,
};

/**
 * Step 1: six lines, one lit. A real radio group - one tab stop, the arrow
 * keys move through the lines and select as they go.
 */
export function Switchboard({ topic, onChange }: { topic: TopicKey; onChange: (key: TopicKey) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % TOPICS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + TOPICS.length) % TOPICS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TOPICS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(TOPICS[next].key);
    refs.current[next]?.focus();
  };

  return (
    <section id="switchboard" className="c3p-switchboard" aria-labelledby="c3p-switch-h">
      <div className="c3p-section-head">
        <div>
          <p className="c3p-eyebrow">Step 1 · Pick a line</p>
          <h2 id="c3p-switch-h" className="c3p-h2">
            What's on your mind?
          </h2>
        </div>
        <p className="c3p-section-note">Choosing a line gets your message to the right place faster, and shows you the right questions.</p>
      </div>

      <div className="c3p-lines" role="radiogroup" aria-label="What your message is about">
        {TOPICS.map((t, i) => {
          const selected = t.key === topic;
          return (
            <button
              key={t.key}
              ref={(el) => (refs.current[i] = el)}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              className={`c3p-line${selected ? " is-on" : ""}`}
              onClick={() => onChange(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="c3p-line-icon">{ICONS[t.key]}</span>
              <span className="c3p-line-body">
                <span className="c3p-line-num">{lineLabel(t)}</span>
                <span className="c3p-line-title">{t.title}</span>
                <span className="c3p-line-text">{t.text}</span>
              </span>
              <span className="c3p-led" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
