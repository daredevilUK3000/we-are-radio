import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { mediaUrl, publicApi } from "../../api/client";
import { LikeButton, useLikes } from "./LikeButton";
import "./playerExtras.css";

/**
 * "What was that song?" (handoff_player_upgrades.md §2): the last songs on
 * the channel, each with a Like and a link to its page. Used in the expanded
 * player and on Listen. Refreshed when it appears and whenever the song on
 * air changes (a song just finished, so the list gained one) - no polling of
 * its own. Hidden entirely when there's nothing to show.
 */

type Played = { track_id: string; title: string; artist: string | null; artwork_url: string | null; aired_at: number };

const SHOWN = 5;
const MORE = 10;
/** The "That was" chip on Listen hides this long after the song ended. */
const CHIP_SECONDS = 3 * 60;

/** "4 min ago", then a clock time (the listener's own) after an hour. */
function when(airedAt: number, nowSec: number): string {
  const mins = Math.max(0, Math.floor((nowSec - airedAt) / 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(airedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function useJustPlayed(channelSlug: string, nowPlayingId: string | null | undefined) {
  const [items, setItems] = useState<Played[]>([]);
  useEffect(() => {
    let live = true;
    publicApi
      .recentlyPlayed(channelSlug, MORE)
      .then((r) => live && setItems(r.available ? r.items : []))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [channelSlug, nowPlayingId]);
  return items;
}

export function JustPlayed({ items, className = "" }: { items: Played[]; className?: string }) {
  const [more, setMore] = useState(false);
  const likes = useLikes("track", items.map((i) => i.track_id));
  // Re-render every half minute so "4 min ago" keeps up.
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Date.now() / 1000), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (items.length === 0) return null;
  const shown = items.slice(0, more ? MORE : SHOWN);

  return (
    <section className={`jp ${className}`} aria-label="Just played">
      <div className="jp-head">Just played</div>
      <ul className="jp-list">
        {shown.map((i) => (
          <li key={i.track_id} className="jp-row">
            <Link to={`/track/${i.track_id}`} className="jp-link">
              {i.artwork_url ? <img className="jp-art" src={mediaUrl(i.artwork_url)} alt="" loading="lazy" /> : <span className="jp-art jp-art-empty" />}
              <span className="jp-text">
                <span className="jp-title">{i.title}</span>
                {i.artist && <span className="jp-artist">{i.artist}</span>}
              </span>
              <span className="jp-when">{when(i.aired_at, nowSec)}</span>
            </Link>
            <LikeButton liked={likes.isLiked(i.track_id)} onToggle={() => likes.toggle(i.track_id)} className="jp-like" iconOnly />
          </li>
        ))}
      </ul>
      {items.length > SHOWN && !more && (
        <button type="button" className="jp-more" onClick={() => setMore(true)}>
          Show more
        </button>
      )}
    </section>
  );
}

/**
 * Listen only: "That was: {title} · {artist}" with a heart, for the three
 * minutes after a song ends. `endedAt` is when the item now on air started.
 */
export function ThatWasChip({ items, endedAt }: { items: Played[]; endedAt: number | null }) {
  const last = items[0];
  const likes = useLikes("track", last ? [last.track_id] : []);
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNowSec(Date.now() / 1000), 5_000);
    return () => window.clearInterval(id);
  }, []);
  if (!last || !endedAt || nowSec - endedAt > CHIP_SECONDS || last.aired_at >= endedAt) return null;
  return (
    <div className="jp-chip" role="status">
      <Link to={`/track/${last.track_id}`} className="jp-chip-text">
        <span className="jp-chip-label">That was:</span> {last.title}
        {last.artist ? <span className="jp-artist"> · {last.artist}</span> : null}
      </Link>
      <LikeButton liked={likes.isLiked(last.track_id)} onToggle={() => likes.toggle(last.track_id)} className="jp-like" iconOnly />
    </div>
  );
}
