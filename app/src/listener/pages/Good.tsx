import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import type { GoodAd } from "../../api/client";
import { ShareButton } from "../components/ShareButton";
import { GoodPlayButton, HeartIcon, useGoodProgress } from "../components/good/GoodSection";
import { clock, useGoodAds } from "../components/good/goodPreview";
import { useOnline } from "../../shared/offline";

/**
 * /good and /good/<slug> (handoff_advertising_for_good.md §6). Every published
 * ad, playable and shareable. Arriving on an ad's own link scrolls to it and
 * highlights it, but never plays it without a tap.
 */

const prefersReducedMotion =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

function AdCard({ ad, highlighted }: { ad: GoodAd; highlighted: boolean }) {
  const { pct } = useGoodProgress(ad);
  return (
    <li id={`ad-${ad.slug}`} className={highlighted ? "afg-ad is-highlighted" : "afg-ad"}>
      <GoodPlayButton ad={ad} />
      <div className="afg-ad-text">
        <div className="afg-ad-title">{ad.title}</div>
        <div className="afg-ad-time">{clock(ad.duration_seconds)}</div>
      </div>
      <ShareButton
        path={`/good/${ad.slug}`}
        title={`${ad.title} · Advertising For Good`}
        text="A short message from We Are Radio that asks you to be kind, not to buy."
        className="afg-share"
      />
      <span className="afg-row-progress" aria-hidden="true" style={{ width: `${pct * 100}%` }} />
    </li>
  );
}

export function Good() {
  const { slug } = useParams();
  const data = useGoodAds();
  const online = useOnline();
  const ads = data?.ads ?? [];
  const target = slug ? ads.find((a) => a.slug === slug) : undefined;
  useTitle(target ? `${target.title} · Advertising For Good · We Are Radio` : "Advertising For Good · We Are Radio");

  // Once, when the ads arrive: bring the shared ad into view and put focus on its play button.
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!target || scrolled.current === target.slug) return;
    scrolled.current = target.slug;
    const card = document.getElementById(`ad-${target.slug}`);
    card?.scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" });
    card?.querySelector<HTMLButtonElement>(".afg-play")?.focus({ preventScroll: true });
  }, [target]);

  return (
    <div className="afg-page">
      <header className="afg-page-head">
        <span className="afg-eyebrow">
          <HeartIcon />
          Advertising For Good
        </span>
        <h1 className="afg-page-title">Advertising For Good</h1>
        <p className="afg-page-sub">
          Radio has always been good at getting a message into people's heads. We thought we'd use that for something useful.
        </p>
      </header>

      <section className="afg-page-section">
        <h2>What it is</h2>
        <p>
          Most ads want you to spend. Ours ask you to do something that costs nothing: knock on a neighbour's door, make time for
          someone who's on their own, give a stranger the benefit of the doubt, keep faith that things can get better.
        </p>
        <p>Each one lasts around half a minute. You'll hear them between songs on every We Are Radio channel.</p>
      </section>

      <section className="afg-page-section">
        <h2>Why we do it</h2>
        <p>
          A radio station keeps people company. It's there in the kitchen, the car, the quiet part of the evening. That's a
          privilege, and we'd rather spend those few seconds between songs on something that leaves you, and the people around
          you, a little better off.
        </p>
      </section>

      <section className="afg-page-section" aria-labelledby="afg-listen">
        <h2 id="afg-listen">Listen</h2>
        {ads.length > 0 ? (
          <ul className="afg-grid">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} highlighted={ad.slug === slug} />
            ))}
          </ul>
        ) : (
          <p className="afg-page-dim">{online ? (data ? "None to play just now. Check back soon." : "Loading…") : "Connect to the internet to hear them."}</p>
        )}
      </section>

      <section className="afg-page-section">
        <h2>Pass it on</h2>
        <p>If one of these made you think of someone, send it to them. Every ad has its own link.</p>
      </section>

      <section className="afg-page-section">
        <h2>Add your voice</h2>
        <p>
          Has someone been kind to you lately, or have you seen something that restored your faith in people? Tell us in a voice
          note. The best ones may become the next Advertising For Good.
        </p>
        <Link to="/on-air" className="afg-cta">
          Click here to send a shout out. Spread the love.
        </Link>
      </section>

      {data?.causeEnabled && (
        <section className="afg-page-section">
          <h2>Got a cause?</h2>
          <p>
            If you run a charity or community group and have a message that fits, we'd like to hear from you:{" "}
            <a href="mailto:info@weareradio.app" className="afg-green">
              info@weareradio.app
            </a>
          </p>
        </section>
      )}
    </div>
  );
}
