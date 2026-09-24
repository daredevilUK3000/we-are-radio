import { Link } from "react-router-dom";
import { CONTEST_TITLE } from "../../components/contest/common";
import { RULES_LAST_UPDATED, RULES_SECTIONS, type RulesBlock } from "./rulesContent";

/** /top3/rules - static text from rulesContent.ts. */

function Block({ block }: { block: RulesBlock }) {
  if ("list" in block) {
    return (
      <ul>
        {block.list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  if ("table" in block) {
    // Wide tables scroll sideways inside their own box on a phone, never the whole page.
    return (
      <div className="t3-rules-table">
        <table>
          <thead>
            <tr>
              {block.table.head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (!block.p) return <h3>{block.lead}</h3>;
  return (
    <p>
      {block.lead && <strong>{block.lead} </strong>}
      {block.p}
    </p>
  );
}

export function ContestRules() {
  return (
    <div className="tc t3-rules">
      <span className="rfy-eyebrow">{CONTEST_TITLE}</span>
      <h1 className="rfy-h1">Official rules</h1>
      {RULES_SECTIONS.length === 0 ? (
        <p className="rfy-lede">Official rules will be published here before entries open.</p>
      ) : (
        <>
          {RULES_LAST_UPDATED && <p className="tc-fine">Last updated {RULES_LAST_UPDATED}</p>}
          {RULES_SECTIONS.map((s) => (
            <section key={s.heading}>
              <h2>{s.heading}</h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </section>
          ))}
        </>
      )}
      <p className="t3-footer-links">
        <Link to="/top3">Back to the Top 3</Link>
      </p>
    </div>
  );
}
