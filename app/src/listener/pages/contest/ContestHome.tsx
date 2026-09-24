import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { contestApi, mediaUrl, type ContestEntry } from "../../../api/client";
import { countryName } from "../../../shared/countries";
import { useExclusiveAudio } from "../../lib/audioUtils";
import { useLikes } from "../../components/LikeButton";
import { CONTEST_TITLE, NotifySignup, SongCard, parisDay, useContestState } from "../../components/contest/common";

/**
 * /top3 - the home of We Are Radio's Top 3 Creator Songs of 2026 during the
 * entry phase: what it is, the dates, how many songs and countries are in,
 * and every approved song to browse (in a daily shuffle, so nobody is always
 * at the top). There is deliberately no Vote button yet - voting is Phase B.
 */

const PAGE_SIZE = 24;
// An almost-empty counter on launch day looks quiet rather than exciting.
const COUNTER_MINIMUM = 10;

export function ContestHome() {
  const { state } = useContestState();
  const [country, setCountry] = useState("");
  const [entries, setEntries] = useState<ContestEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const likes = useLikes("contest_entry", entries.map((e) => String(e.id)));

  useExclusiveAudio("top3-grid", audioRef, true, () => setPlayingId(null));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    contestApi
      .entries({ country: country || undefined, limit: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
        setCursor(r.nextCursor);
      })
      .catch(() => !cancelled && setEntries([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [country]);

  const loadMore = () => {
    if (!cursor) return;
    setLoading(true);
    contestApi
      .entries({ country: country || undefined, cursor, limit: PAGE_SIZE })
      .then((r) => {
        setEntries((prev) => [...prev, ...r.entries.filter((e) => !prev.some((p) => p.id === e.id))]);
        setCursor(r.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // One hidden player for the whole grid: Listen on another card switches to it.
  const togglePlay = (entry: ContestEntry) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === entry.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = mediaUrl(entry.audio_url);
    audio.play().then(
      () => setPlayingId(entry.id),
      () => setPlayingId(null)
    );
  };

  const phase = state?.phase;
  const showCounter = state && state.approvedCount >= COUNTER_MINIMUM;

  return (
    <div className="t3">
      <section className="t3-hero">
        <span className="rfy-eyebrow">International competition</span>
        <h1 className="rfy-h1">{CONTEST_TITLE}</h1>
        <p className="rfy-lede">
          We're looking for the three best songs made by Independent Creators this year, from anywhere in the world.
        </p>

        {state && (
          <div className="t3-phase">
            {phase === "before_entries" && (
              <>
                <p className="t3-phase-line">
                  Entries open <strong>{parisDay(state.dates.entriesOpen)}</strong>.
                </p>
                {state.studioPreview && (
                  <Link to="/top3/enter" className="pill-btn pill-btn-ghost">
                    Studio preview: try the entry form
                  </Link>
                )}
              </>
            )}
            {phase === "entries_open" && (
              <>
                <Link to="/top3/enter" className="pill-btn pill-btn-solid t3-cta">
                  Enter your song
                </Link>
                <p className="t3-phase-line">
                  Entries close {parisDay(state.dates.entriesClose)} · Voting opens {parisDay(state.dates.votingOpen)}
                </p>
              </>
            )}
            {(phase === "voting" || phase === "results_pending") && (
              <p className="t3-phase-line">Entries are closed. Thank you to every Creator who entered.</p>
            )}
            {phase === "complete" && <p className="t3-phase-line">The winners have been announced. Thank you for listening.</p>}
          </div>
        )}

        {showCounter && (
          <p className="t3-counter">
            <strong>{state.approvedCount.toLocaleString("en-GB")}</strong> songs from{" "}
            <strong>{state.countryCount.toLocaleString("en-GB")}</strong> countries
          </p>
        )}
      </section>

      <ol className="t3-steps">
        <li>
          <span className="t3-step-num">1</span>
          <strong>Enter</strong>
          <span>Upload your 2026 song by 31 March 2027.</span>
        </li>
        <li>
          <span className="t3-step-num">2</span>
          <strong>Get played on We Are Radio</strong>
          <span>Approved songs get their own page, and can feature on our Creator Spotlight Show.</span>
        </li>
        <li>
          <span className="t3-step-num">3</span>
          <strong>Listeners vote from April</strong>
          <span>Voting opens on 1 April 2027. The Top 3 are announced in September.</span>
        </li>
      </ol>

      {(phase === "before_entries" || phase === "entries_open") && <NotifySignup />}

      <section className="t3-browse">
        <div className="t3-browse-head">
          <h2>The songs</h2>
          {state && state.byCountry.length > 1 && (
            <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Filter by country">
              <option value="">All countries</option>
              {[...state.byCountry]
                .map((c) => ({ ...c, name: countryName(c.code) }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.n})
                  </option>
                ))}
            </select>
          )}
        </div>

        {entries.length === 0 && !loading && (
          <p className="tc-fine">
            {phase === "before_entries"
              ? "The first songs will appear here once entries open and we've listened to them."
              : "No songs here yet - we listen to every entry before it appears."}
          </p>
        )}

        <div className="t3-grid">
          {entries.map((e) => (
            <SongCard
              key={e.id}
              entry={e}
              playing={playingId === e.id}
              onPlay={() => togglePlay(e)}
              liked={likes.isLiked(String(e.id))}
              onLike={() => likes.toggle(String(e.id))}
              showLike={!!state?.likesOpen}
            />
          ))}
        </div>

        {cursor && (
          <div className="t3-more">
            <button className="pill-btn pill-btn-ghost" onClick={loadMore} disabled={loading}>
              {loading ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </section>

      <p className="t3-footer-links">
        <Link to="/top3/rules">Official rules</Link>
        {phase === "entries_open" && (
          <>
            {" · "}
            <Link to="/top3/enter">Enter your song</Link>
          </>
        )}
      </p>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} style={{ display: "none" }} />
    </div>
  );
}
