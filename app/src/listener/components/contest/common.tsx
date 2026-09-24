import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { contestApi, mediaUrl, ApiError, type ContestEntry, type ContestState } from "../../../api/client";
import { countryFlag, countryName } from "../../../shared/countries";
import { Turnstile, type TurnstileHandle } from "../../../shared/Turnstile";
import { ShareButton } from "../ShareButton";
import { LikeButton } from "../LikeButton";

/** Shared bits of the Top 3 contest pages (app/src/listener/pages/contest/). */

export const CONTEST_TITLE = "We Are Radio's Top 3 Creator Songs of 2026";

export function useContestState() {
  const [state, setState] = useState<ContestState | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    contestApi
      .state()
      .then(setState)
      .catch(() => setError(true));
  }, []);
  return { state, error };
}

/** "1 April 2027" from an ISO instant, in Paris time (every contest date is Paris time). */
export function parisDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

export function shareMessage(entry: Pick<ContestEntry, "title">, url: string) {
  return `Listen to my song "${entry.title}" on We Are Radio, and vote for it when voting opens on 1 April! ${url}`;
}

export function CountryLabel({ code }: { code: string }) {
  return (
    <span className="t3-country">
      <span aria-hidden="true">{countryFlag(code)}</span> {countryName(code)}
    </span>
  );
}

/** One song in the /top3 browse grid - the "Song #127 - Title / Creator / Listen Like Share" card. */
export function SongCard({
  entry,
  playing,
  onPlay,
  liked,
  onLike,
  showLike,
}: {
  entry: ContestEntry;
  playing: boolean;
  onPlay: () => void;
  liked: boolean;
  onLike: () => void;
  showLike: boolean;
}) {
  return (
    <article className={`t3-card${playing ? " playing" : ""}`}>
      <Link to={`/top3/${entry.id}`} className="t3-card-top">
        <div className="t3-card-art">
          {entry.photo_url ? <img src={mediaUrl(entry.photo_url)} alt="" loading="lazy" /> : <span>#{entry.id}</span>}
        </div>
        <div className="t3-card-text">
          <span className="t3-card-num">Song #{entry.id}</span>
          <span className="t3-card-title">{entry.title}</span>
          <span className="t3-card-creator">
            {entry.creator_name} · <CountryLabel code={entry.country_code} />
          </span>
        </div>
      </Link>
      <div className="t3-card-actions">
        <button type="button" className="btn" onClick={onPlay} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : "▶ Listen"}
        </button>
        {showLike && <LikeButton liked={liked} onToggle={onLike} />}
        <ShareButton
          path={`/top3/${entry.id}`}
          title={`"${entry.title}" - ${CONTEST_TITLE}`}
          text={`Listen to "${entry.title}" by ${entry.creator_name} on We Are Radio`}
        />
      </div>
    </article>
  );
}

/**
 * "Remind me when voting opens": email, an unticked news opt-in, the real-person
 * check and a honeypot. Double opt-in - the email carries a confirm link, and
 * the reply is the same whether or not the address was already signed up.
 */
export function NotifySignup({ entryId }: { entryId?: number }) {
  const [email, setEmail] = useState("");
  const [wantsNews, setWantsNews] = useState(false);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Please complete the check below first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await contestApi.notify({ email, entryId, wantsNews, turnstileToken: token, website });
      setDone(true);
    } catch (err) {
      setError((err instanceof ApiError && err.friendly) || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      turnstile.current?.reset();
    }
  };

  if (done) {
    return (
      <div className="t3-notify">
        <strong>Nearly done: check your email.</strong>
        <p className="tc-fine">Click the link we've sent to confirm, and we'll email you when voting opens on 1 April 2027.</p>
      </div>
    );
  }

  return (
    <form className="t3-notify" onSubmit={submit}>
      <strong>Remind me when voting opens</strong>
      <div className="t3-notify-row">
        <input
          type="email"
          required
          maxLength={254}
          placeholder="Your email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Your email"
        />
        <button type="submit" className="pill-btn pill-btn-solid" disabled={busy}>
          {busy ? "Sending..." : "Remind me"}
        </button>
      </div>
      <label className="t3-check">
        <input type="checkbox" checked={wantsNews} onChange={(e) => setWantsNews(e.target.checked)} />
        <span>Also send me We Are Radio news</span>
      </label>
      <label className="tc-hp" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <Turnstile ref={turnstile} action="notify" onToken={setToken} />
      {error && <p className="tc-error">{error}</p>}
      <p className="tc-fine">We'll only email you about this. Every email has an unsubscribe link.</p>
    </form>
  );
}
