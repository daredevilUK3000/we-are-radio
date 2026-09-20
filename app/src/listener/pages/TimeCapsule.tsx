import { useMemo, useState } from "react";
import { publicApi } from "../../api/client";

/**
 * Time Capsule: ask for a short message from Kizzi to go out on air on a date
 * that matters - a birthday, a get-well, an anniversary.
 *
 * It is a REQUEST, not an upload: nothing is recorded by the visitor and
 * nothing airs until Kizzi has recorded or approved it herself.
 */

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const NOTE_LIMIT = 600;

export function TimeCapsule() {
  const { minDate, maxDate } = useMemo(() => {
    const min = new Date();
    min.setDate(min.getDate() + 1);
    const max = new Date();
    max.setDate(max.getDate() + 730);
    return { minDate: isoDate(min), maxDate: isoDate(max) };
  }, []);

  const [requester, setRequester] = useState("");
  const [recipient, setRecipient] = useState("");
  const [occasion, setOccasion] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // a trap for form-filling bots; real people never see it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ date: string; recipient: string; occasion: string; email: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicApi.requestTimeCapsule({
        requester_name: requester,
        recipient_name: recipient,
        occasion_label: occasion,
        scheduled_date: date,
        message_note: note,
        notify_email: email,
        website,
      });
      setSent({ date, recipient, occasion, email: !!email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSent(null);
    setRecipient("");
    setOccasion("");
    setDate("");
    setNote("");
  };

  if (sent) {
    const pretty = new Date(`${sent.date}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <div className="tc">
        <span className="rfy-eyebrow">Time capsule</span>
        <h1 className="rfy-h1">Request received</h1>
        <div className="tc-card">
          <p className="tc-sent-line">
            Thank you. Kizzi will record a message for <strong>{sent.recipient}</strong> - <em>{sent.occasion}</em> - to go
            out on air on <strong>{pretty}</strong>.
          </p>
          <p className="tc-fine">
            It will play at some point during that day, not at a set time. Kizzi listens to every request before anything
            is recorded or scheduled.
            {sent.email ? " We'll only use your email for a heads-up when it's about to go out." : ""}
          </p>
          <button className="pill-btn pill-btn-ghost" onClick={reset}>
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tc">
      <span className="rfy-eyebrow">Time capsule</span>
      <h1 className="rfy-h1">A moment on the radio, on the day that matters</h1>
      <p className="rfy-lede">
        A birthday, a get-well, an anniversary. Tell us who it's for and when, and Kizzi will record a short message that
        goes out on We Are Radio on that date.
      </p>

      <ol className="tc-steps">
        <li>
          <strong>Tell us</strong> who it's for, the occasion, the date, and what you'd like said.
        </li>
        <li>
          <strong>Kizzi records it</strong> herself - every message is heard and approved before it airs.
        </li>
        <li>
          <strong>It goes out on air</strong> on your date.
        </li>
      </ol>

      <form className="tc-card" onSubmit={submit}>
        <div className="tc-grid">
          <label className="tc-field">
            <span>Your name</span>
            <input value={requester} onChange={(e) => setRequester(e.target.value)} maxLength={80} required autoComplete="name" />
          </label>
          <label className="tc-field">
            <span>Who is it for?</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={80} required placeholder="e.g. Mum" />
          </label>
          <label className="tc-field">
            <span>What's the occasion?</span>
            <input
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              maxLength={120}
              required
              placeholder="e.g. Mum's 60th birthday"
            />
          </label>
          <label className="tc-field">
            <span>Date it should go on air</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={minDate} max={maxDate} required />
          </label>
        </div>

        <label className="tc-field">
          <span>What would you like said?</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_LIMIT))}
            rows={5}
            required
            placeholder="A few words about the person, a memory, a message - whatever you'd like Kizzi to say."
          />
          <small>
            {note.length} / {NOTE_LIMIT}
          </small>
        </label>

        <label className="tc-field">
          <span>Your email (optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" />
          <small>Only if you'd like a heads-up when it's about to go out. We won't use it for anything else.</small>
        </label>

        {/* Honeypot: hidden from people and screen readers, tempting to bots. */}
        <label className="tc-hp" aria-hidden="true">
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>

        {error && <p className="tc-error">{error}</p>}

        <div className="tc-actions">
          <button type="submit" className="pill-btn pill-btn-solid" disabled={busy}>
            {busy ? "Sending..." : "Send my request"}
          </button>
        </div>
        <p className="tc-fine">
          You're not uploading anything: Kizzi records every message herself, so nothing goes out unchecked. It airs at some
          point during your chosen day, not at a promised time.
        </p>
      </form>
    </div>
  );
}
