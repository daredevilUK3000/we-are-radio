import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { mediaUrl, publicApi } from "../../api/client";
import { onAirApi, type ManageView, type PublicClip } from "../../api/onAir";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { SayItOnAir, MicIcon, type OnAirNowPlaying } from "../components/onair/SayItOnAir";
import { ShareButton } from "../components/ShareButton";
import "../components/onair/onair.css";

/**
 * /on-air (handoff_say_it_on_air.md §3.2), plus the pages the emails link to:
 * /on-air/manage (take it back), /on-air/m/:id (listen-back, private) and
 * /on-air/:publicId (the share page, only when the listener agreed).
 */

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Will everyone hear my name?",
    a: "Only your first name and where you're listening from, if you give it. Your email is only for telling you when you're on air. We never publish it.",
  },
  {
    q: "How long until it's on?",
    a: "Kizzi listens to every message himself, usually within a day or two. If yours is picked, we email you to say when it's going out, so you can tune in.",
  },
  {
    q: "Can I take it back?",
    a: "Yes. Every email we send has a link to take your message back before it airs, or to remove the recording after it has.",
  },
  {
    q: "What won't you play?",
    a: "We don't air messages that are abusive, discriminatory, sexual, advertising, political campaigning, personal details (phone numbers, addresses, surnames of other people), anything about someone who hasn't agreed, or recordings of music you don't own. Kizzi decides what goes on air.",
  },
];

function useTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

export function OnAir() {
  useTitle("Send a shout out · We Are Radio");
  const { channelSlug } = useActiveChannel();
  const [nowPlaying, setNowPlaying] = useState<OnAirNowPlaying | null>(null);
  useEffect(() => {
    publicApi
      .nowPlaying(channelSlug)
      .then((d) => setNowPlaying(d?.on_air && d.now_playing ? { label: d.now_playing.label, track_id: d.now_playing.track_id, item_type: d.now_playing.item_type } : null))
      .catch(() => setNowPlaying(null));
  }, [channelSlug]);

  return (
    <div className="oa-page">
      <section className="oa-hero">
        <div className="oa-eyebrow">
          <span className="oa-rec-dot" /> Send a shout out
        </div>
        <h1>
          Your voice.
          <br />
          <span>On the radio.</span>
        </h1>
        <p>Record a shout-out, a dedication or a question for Kizzi, right here in your browser. Up to 45 seconds.</p>
        <ol className="oa-how">
          <li>
            <strong>Record</strong>
            <span>Tap the mic and say your piece.</span>
          </li>
          <li>
            <strong>Kizzi listens</strong>
            <span>Every message, himself.</span>
          </li>
          <li>
            <strong>Hear yourself on air</strong>
            <span>We email you when it's going out.</span>
          </li>
        </ol>
      </section>

      <section className="oa-page-recorder">
        <SayItOnAir channelSlug={channelSlug} nowPlaying={nowPlaying} variant="page" />
      </section>

      <section className="oa-faq" aria-label="Questions">
        <h2>Good to know</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
        <p className="oa-cross">
          Want Kizzi to record a message for a special date instead? <Link to="/time-capsule">Try a Time Capsule →</Link>
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------- manage

const STATUS_TEXT: Record<ManageView["status"], string> = {
  pending: "Kizzi hasn't listened to it yet.",
  approved: "Kizzi has listened to it and is choosing when it goes out.",
  scheduled: "It's lined up to go out on air soon.",
  placed: "It's in the running order.",
  aired: "It has been on air.",
  withdrawn: "You took this message back. We've deleted the recording.",
  closed: "This message won't be going on air.",
};

const clock = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" });

export function OnAirManage() {
  useTitle("Your message · We Are Radio");
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const token = params.get("t") ?? "";
  const [view, setView] = useState<ManageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | "withdraw" | "remove_clip">(null);

  useEffect(() => {
    if (!id || !token) {
      setError("This link isn't complete. Please use the link from your email.");
      return;
    }
    onAirApi
      .manage(id, token)
      .then((r) => setView(r.view))
      .catch((e) => setError(e?.friendly ?? "This link isn't valid. Please use the link from your most recent email."));
  }, [id, token]);

  const act = async (action: "withdraw" | "remove_clip") => {
    setBusy(true);
    setError(null);
    try {
      const r = await onAirApi.manage(id, token, action);
      setView(r.view);
      setConfirming(null);
    } catch (e: any) {
      setError(e?.friendly ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oa-page oa-narrow">
      <div className="oa-card">
        <div className="oa-eyebrow">Send a shout out</div>
        {!view && !error && <p>Loading...</p>}
        {error && (
          <p className="oa-error" role="alert">
            {error}
          </p>
        )}
        {view && (
          <>
            <h1 className="oa-card-title">{view.first_name ? `Hi ${view.first_name}` : "Your message"}</h1>
            <p className="oa-status">{STATUS_TEXT[view.status]}</p>
            {view.status === "placed" && view.expected_at && view.channel && (
              <p>
                It should go out on {view.channel.name} at around {clock(view.expected_at)}.{" "}
                <Link to={`/channel/${view.channel.slug}`}>Tune in</Link>
              </p>
            )}
            {view.status === "aired" && view.aired_at && view.channel && (
              <p>
                You were on {view.channel.name} on {clock(view.aired_at)}.
              </p>
            )}
            {view.audio_url && <audio className="oa-audio" controls src={mediaUrl(view.audio_url)} preload="none" />}

            {view.can_withdraw &&
              (confirming === "withdraw" ? (
                <div className="oa-confirm">
                  <p>Take your message back? We'll delete the recording and it won't go on air.</p>
                  <div className="oa-row">
                    <button type="button" className="oa-btn" onClick={() => setConfirming(null)} disabled={busy}>
                      Keep it
                    </button>
                    <button type="button" className="oa-btn oa-btn-red" onClick={() => void act("withdraw")} disabled={busy}>
                      {busy ? "Taking it back..." : "Yes, take it back"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="oa-btn" onClick={() => setConfirming("withdraw")}>
                  Take it back
                </button>
              ))}

            {view.can_remove_clip &&
              (confirming === "remove_clip" ? (
                <div className="oa-confirm">
                  <p>It's already been broadcast, so we can't take that back, but we'll remove the recording.</p>
                  <div className="oa-row">
                    <button type="button" className="oa-btn" onClick={() => setConfirming(null)} disabled={busy}>
                      Keep it
                    </button>
                    <button type="button" className="oa-btn oa-btn-red" onClick={() => void act("remove_clip")} disabled={busy}>
                      {busy ? "Removing..." : "Remove the clip"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="oa-btn" onClick={() => setConfirming("remove_clip")}>
                  Remove the clip
                </button>
              ))}
            {view.status === "aired" && !view.can_remove_clip && <p className="oa-dim">The recording has been removed.</p>}
          </>
        )}
        <p className="oa-card-foot">
          <Link to="/on-air">Record another message</Link> · <Link to="/">Listen live</Link>
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------- listen-back (private)

export function OnAirListenBack() {
  useTitle("Hear it again · We Are Radio");
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const [view, setView] = useState<ManageView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Never indexed (the Worker sends noindex too, for crawlers that don't run this).
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    onAirApi
      .manage(id, token)
      .then((r) => setView(r.view))
      .catch((e) => setError(e?.friendly ?? "This link isn't valid."));
  }, [id, token]);

  return (
    <div className="oa-page oa-narrow">
      <div className="oa-card oa-card-hero">
        <div className="oa-eyebrow">
          <span className="oa-rec-dot" /> On air
        </div>
        {error && <p className="oa-error">{error}</p>}
        {view && view.status === "aired" && view.audio_url ? (
          <>
            <h1 className="oa-card-title">That was you{view.channel ? ` on ${view.channel.name}` : ""}!</h1>
            {view.aired_at && <p className="oa-dim">{clock(view.aired_at)}</p>}
            <audio className="oa-audio" controls src={mediaUrl(view.audio_url)} />
            {view.share_url && (
              <ShareButton
                path={new URL(view.share_url).pathname}
                title="I was on We Are Radio"
                text={`Hear me on ${view.channel?.name ?? "We Are Radio"}!`}
                className="oa-btn oa-btn-red"
              />
            )}
          </>
        ) : view ? (
          <p>{view.status === "aired" ? "The recording has been removed." : "Your message hasn't been on air yet. We'll email you when it has."}</p>
        ) : null}
        <p className="oa-card-foot">
          <Link to={`/on-air/manage?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`}>Manage your message</Link> ·{" "}
          <Link to="/on-air">Send another shout out</Link>
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------- share page

export function OnAirShare() {
  const { publicId = "" } = useParams();
  const [clip, setClip] = useState<PublicClip | null>(null);
  const [missing, setMissing] = useState(false);
  const who = clip ? `${clip.first_name}${clip.place ? ` from ${clip.place}` : ""}` : "";
  useTitle(clip ? `${who} was on We Are Radio` : "We Are Radio");

  useEffect(() => {
    onAirApi
      .clip(publicId)
      .then((r) => setClip(r.clip))
      .catch(() => setMissing(true));
  }, [publicId]);

  const kindLine = clip
    ? clip.kind === "dedication" && clip.for_name
      ? `A dedication for ${clip.for_name}`
      : clip.kind === "question"
        ? "A question for Kizzi"
        : clip.kind === "reaction"
          ? "Their take on a song"
          : "A shout-out"
    : "";

  return (
    <div className="oa-page oa-narrow">
      <div className="oa-card oa-card-hero">
        {missing ? (
          <>
            <h1 className="oa-card-title">This clip isn't available</h1>
            <p>It may have been removed.</p>
          </>
        ) : clip ? (
          <>
            <div className="oa-eyebrow">
              <span className="oa-rec-dot" /> Listener voice
            </div>
            <h1 className="oa-card-title">{who} was on We Are Radio</h1>
            <p className="oa-dim">
              {kindLine} · {clip.channel_name ?? "We Are Radio"} · {new Date(clip.aired_at_ms).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <audio className="oa-audio" controls src={mediaUrl(clip.audio_url)} />
            <div className="oa-row">
              <Link className="oa-btn oa-btn-red" to={clip.channel_slug ? `/channel/${clip.channel_slug}` : "/"}>
                Listen live
              </Link>
              <Link className="oa-btn" to="/on-air">
                <MicIcon size={16} /> Send a shout out yourself
              </Link>
            </div>
          </>
        ) : (
          <p>Loading...</p>
        )}
      </div>
    </div>
  );
}
