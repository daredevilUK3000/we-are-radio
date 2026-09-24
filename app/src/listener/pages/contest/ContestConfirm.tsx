import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { contestApi, ApiError } from "../../../api/client";

/**
 * The three pages the contest emails link to: confirm an entry, confirm a
 * "remind me" signup, and unsubscribe. Each reads its token from the link
 * and POSTs it - the email links themselves are plain page loads, because
 * mail scanners follow GET links automatically and would otherwise confirm
 * (or unsubscribe) on someone's behalf.
 */

type Outcome = { kind: "working" } | { kind: "ok"; heading: string; body: string } | { kind: "error"; body: string };

function useRunOnce(run: () => Promise<Outcome>) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "working" });
  const started = useRef(false); // React's StrictMode runs effects twice in development
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run().then(setOutcome, (err) =>
      setOutcome({ kind: "error", body: (err instanceof ApiError && err.friendly) || "Something went wrong. Please try the link again." })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return outcome;
}

function Result({ outcome, workingText }: { outcome: Outcome; workingText: string }) {
  return (
    <div className="tc">
      <span className="rfy-eyebrow">Top 3 Creator Songs of 2026</span>
      <h1 className="rfy-h1">{outcome.kind === "working" ? workingText : outcome.kind === "ok" ? outcome.heading : "That didn't work"}</h1>
      {outcome.kind !== "working" && (
        <div className="tc-card">
          <p className="tc-sent-line">{outcome.body}</p>
          <Link to="/top3" className="pill-btn pill-btn-ghost">
            Go to the Top 3
          </Link>
        </div>
      )}
    </div>
  );
}

export function ContestConfirm() {
  const [params] = useSearchParams();
  const outcome = useRunOnce(async () => {
    const token = params.get("t");
    if (!token) return { kind: "error", body: "This link is missing its code. Please use the full link from your email." };
    const r = await contestApi.confirm(token);
    const title = r.title ? `"${r.title}"` : "Your song";
    return r.alreadyConfirmed
      ? { kind: "ok", heading: "Already confirmed", body: `${title} is already confirmed and in our review queue. We'll email you once we've listened.` }
      : {
          kind: "ok",
          heading: "Entry confirmed",
          body: `Thank you. ${title} is in our review queue. Review takes up to 14 days, and we'll email you either way.`,
        };
  });
  return <Result outcome={outcome} workingText="Confirming your entry..." />;
}

export function ContestNotifyConfirm() {
  const [params] = useSearchParams();
  const outcome = useRunOnce(async () => {
    const token = params.get("t");
    if (!token) return { kind: "error", body: "This link is missing its code. Please use the full link from your email." };
    await contestApi.notifyConfirm(token);
    return { kind: "ok", heading: "You're on the list", body: "We'll email you when voting opens on 1 April 2027." };
  });
  return <Result outcome={outcome} workingText="Confirming..." />;
}

export function ContestUnsubscribe() {
  const [params] = useSearchParams();
  const outcome = useRunOnce(async () => {
    const id = params.get("id");
    const sig = params.get("sig");
    if (!id || !sig) return { kind: "error", body: "This link is incomplete. Please use the full link from your email." };
    await contestApi.unsubscribe(id, sig);
    return { kind: "ok", heading: "Unsubscribed", body: "You won't get any more emails from us about the Top 3." };
  });
  return <Result outcome={outcome} workingText="Unsubscribing..." />;
}
