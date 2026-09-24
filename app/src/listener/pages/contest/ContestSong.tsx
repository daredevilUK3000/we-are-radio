import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { contestApi, mediaUrl, type ContestEntry } from "../../../api/client";
import { shareUrl } from "../../../shared/share";
import { PlayerCard } from "../../components/PlayerCard";
import { ShareButton } from "../../components/ShareButton";
import { LikeButton, useLikes } from "../../components/LikeButton";
import { useExclusiveAudio } from "../../lib/audioUtils";
import { CONTEST_TITLE, CountryLabel, NotifySignup, shareMessage, useContestState } from "../../components/contest/common";

/**
 * /top3/:id - one approved song's own page: the link a Creator shares with
 * their fans. Built like the track page (TrackDetail): the page owns a hidden
 * <audio> element driven by the same PlayerCard, so contest songs - which
 * aren't in the tracks table - need no change to the site's players.
 * Open Graph tags for link previews come from worker/src/routes/shareLinks.ts.
 */
export function ContestSong() {
  const { id } = useParams();
  const { state } = useContestState();
  const [entry, setEntry] = useState<ContestEntry | null>(null);
  const [missing, setMissing] = useState(false);
  const [paused, setPaused] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const likes = useLikes("contest_entry", entry ? [String(entry.id)] : []);

  useExclusiveAudio("top3-song", audioRef, !!entry, () => setPaused(true));

  useEffect(() => {
    if (!id) return;
    setEntry(null);
    setMissing(false);
    contestApi
      .entry(id)
      .then((r) => setEntry(r.entry))
      .catch(() => setMissing(true));
  }, [id]);

  useEffect(() => {
    if (audioRef.current && entry) audioRef.current.src = mediaUrl(entry.audio_url);
  }, [entry]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setPaused(true));
    else audio.pause();
  };

  if (missing) {
    return (
      <div className="t3 t3-narrow">
        <span className="rfy-eyebrow">Top 3 Creator Songs of 2026</span>
        <h1 className="rfy-h1">Song not found</h1>
        <p className="rfy-lede">This song isn't in the competition, or isn't available any more.</p>
        <Link to="/top3" className="pill-btn pill-btn-solid">
          See all the songs
        </Link>
      </div>
    );
  }
  if (!entry) return <p>Loading...</p>;

  const pageUrl = shareUrl(`/top3/${entry.id}`);

  return (
    <div className="t3">
      <div className="td-hero">
        <div className="fa-art-wrap td-art-wrap">
          <div className="fa-ring" aria-hidden="true" />
          <div className="fa-art">
            {entry.photo_url ? (
              <img src={mediaUrl(entry.photo_url)} alt="" />
            ) : (
              <div className="fa-art-placeholder t3-art-fallback">
                <span>Top 3</span>
                <strong>#{entry.id}</strong>
              </div>
            )}
            <div className="fa-shine" aria-hidden="true" />
            <button className="td-play-btn" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>
              {paused ? (
                <span className="play-triangle" />
              ) : (
                <span className="pl-pause-icon">
                  <span />
                  <span />
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="td-info">
          <span className="t3-song-num">Song #{entry.id}</span>
          <h1 className="td-title">{entry.title}</h1>
          <p className="td-artist">
            {entry.creator_name} · <CountryLabel code={entry.country_code} />
          </p>
          <p className="t3-badge">
            <strong>In the running</strong> for {CONTEST_TITLE}
          </p>

          <div className="td-actions">
            <button className="pill-btn pill-btn-solid" onClick={togglePlay}>
              {paused ? <span className="play-triangle" /> : <span className="pl-pause-icon"><span /><span /></span>}
              {paused ? "Play" : "Pause"}
            </button>
            {state?.likesOpen && (
              <LikeButton liked={likes.isLiked(String(entry.id))} onToggle={() => likes.toggle(String(entry.id))} className="td-icon-btn" iconOnly />
            )}
            <ShareButton
              path={`/top3/${entry.id}`}
              title={`"${entry.title}" - ${CONTEST_TITLE}`}
              text={shareMessage(entry, pageUrl)}
              className="td-icon-btn"
              iconOnly
            />
          </div>
        </div>
      </div>

      <div className="td-player">
        <PlayerCard audioRef={audioRef} title={entry.title} fallbackDuration={entry.duration_seconds} hideInfo showVolume />
      </div>

      {(entry.bio || (entry.links && entry.links.length > 0)) && (
        <section className="t3-about">
          <h2>About {entry.creator_name}</h2>
          {entry.bio && <p>{entry.bio}</p>}
          {entry.links && entry.links.length > 0 && (
            <ul className="t3-links">
              {entry.links.map((l) => (
                <li key={l}>
                  <a href={l} target="_blank" rel="nofollow noopener ugc">
                    {l.replace(/^https:\/\//, "").replace(/\/$/, "")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(state?.phase === "before_entries" || state?.phase === "entries_open") && <NotifySignup entryId={entry.id} />}

      <p className="t3-footer-links">
        <Link to="/top3">All the songs</Link>
        {state?.phase === "entries_open" && (
          <>
            {" · "}
            <Link to="/top3/enter">Enter your own song</Link>
          </>
        )}
        {" · "}
        <Link to="/top3/rules">Official rules</Link>
      </p>

      <audio
        ref={audioRef}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
        style={{ display: "none" }}
      />
    </div>
  );
}
