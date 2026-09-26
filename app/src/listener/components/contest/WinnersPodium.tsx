import { Link } from "react-router-dom";
import { countryName } from "../../../shared/countries";
import "./top3-feature.css";

export interface Winner {
  rank: 1 | 2 | 3;
  id: number;
  title: string;
  creator_name: string;
  country_code: string;
}

const PLACE = { 1: "WINNER", 2: "SECOND PLACE", 3: "THIRD PLACE" } as const;

/** The three winners, gold medallions and all. Renders nothing until there are winners to show. */
export function WinnersPodium({ winners }: { winners?: Winner[] }) {
  if (!winners || winners.length === 0) return null;
  const sorted = [...winners].sort((a, b) => a.rank - b.rank);
  return (
    <ol className="t3f-podium">
      {sorted.map((w) => (
        <li key={w.id}>
          <Link to={`/top3/${w.id}`} className="t3f-winner">
            <span className="t3f-medal" aria-hidden="true">
              {w.rank}
            </span>
            <span className="t3f-winner-text">
              <span className="t3f-winner-place">{PLACE[w.rank]}</span>
              <span className="t3f-winner-title">{w.title}</span>
              <span className="t3f-winner-by">
                {w.creator_name} · {countryName(w.country_code)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
