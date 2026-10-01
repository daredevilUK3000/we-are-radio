import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { contactApi, ApiError } from "../../../api/client";
import { Turnstile, type TurnstileHandle } from "../../../shared/Turnstile";
import { previousPage } from "../../../shared/navHistory";
import { LevelMeter } from "./LevelMeter";
import { describeDevice } from "./describeDevice";
import { CONTACT_EMAIL, lineLabel, topicByKey, type ExtraField, type TopicKey } from "./topics";
import { IconCheck, IconSend } from "./icons";

const MESSAGE_MAX = 2000;
const TURNSTILE_MISSING = "Please complete the check first. It confirms you're a real person.";
const MESSAGE_MIN = 10;

// Extra fields are named x_<key> in the form, so a topic's "website" can never meet the honeypot.
const xName = (key: string) => `x_${key}`;

/** Friendly words for whatever the browser's own checks found wrong with a field. */
function problemWith(el: HTMLInputElement | HTMLTextAreaElement, label: string): string {
  const v = el.validity;
  if (el.name === "name" && v.valueMissing) return "Please tell us your name.";
  if (el.name === "email") return v.valueMissing ? "Please give us your email address, so we can reply." : "Please check your email address.";
  if (el.name === "message") {
    if (v.valueMissing) return "Please write your message.";
    if (v.tooShort) return `Your message is a little short. Please write at least ${MESSAGE_MIN} characters.`;
  }
  if (v.valueMissing) return `Please fill in "${label}".`;
  if (v.typeMismatch && el.type === "url") return "Please give the full address, starting with https://";
  if (v.patternMismatch) return "Song numbers are digits only, like 142.";
  if (v.rangeUnderflow || v.rangeOverflow || v.badInput) return "Please choose a date.";
  return el.validationMessage || "Please check this field.";
}

function initialExtras(): Record<string, string> {
  return { device: describeDevice(), page: previousPage() ?? "" };
}

export function ContactForm({ topic: topicKey }: { topic: TopicKey }) {
  const topic = topicByKey(topicKey);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  // Every topic's extra fields in one place, so switching lines and back keeps what was typed.
  const [extras, setExtras] = useState<Record<string, string>>(initialExtras);
  const [onAir, setOnAir] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<TopicKey | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  // A new line after sending starts a new message.
  useEffect(() => {
    setSent((s) => (s && s !== topicKey ? null : s));
  }, [topicKey]);

  // Sent: the heading takes focus (and is read out). "Send another": back to the message box.
  const refocusMessage = useRef(false);
  useEffect(() => {
    if (sent) sentHeading.current?.focus();
    else if (refocusMessage.current) {
      refocusMessage.current = false;
      formRef.current?.querySelector<HTMLElement>('[name="message"]')?.focus();
    }
  }, [sent]);

  const focusField = (field: string) => {
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`) ?? formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    el?.focus();
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const clearError = (field: string) =>
    setErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const form = formRef.current!;

    // A website typed without https:// is fixed up, not refused.
    const site = extras.website?.trim();
    if (topic.key === "business" && site && !/^[a-z][a-z0-9+.-]*:\/\//i.test(site)) {
      const fixed = `https://${site}`;
      setExtras((x) => ({ ...x, website: fixed }));
      const input = form.querySelector<HTMLInputElement>(`[name="${xName("website")}"]`);
      if (input) input.value = fixed;
    }

    // The browser's own checks (required, email, length...), reported in our words beside each field.
    const labels: Record<string, string> = Object.fromEntries(topic.fields.map((f) => [xName(f.key), f.label]));
    const problems: Record<string, string> = {};
    for (const el of Array.from(form.elements) as (HTMLInputElement | HTMLTextAreaElement)[]) {
      if (!el.name || el.name === "company_url" || !el.willValidate || el.validity.valid) continue;
      problems[el.name] = problemWith(el, labels[el.name] ?? "this field");
    }
    // Spaces alone don't count (the server trims them too).
    if (!problems.message && message.trim().length < MESSAGE_MIN) {
      problems.message = message.trim() ? `Your message is a little short. Please write at least ${MESSAGE_MIN} characters.` : "Please write your message.";
    }
    if (!token) problems.turnstile = TURNSTILE_MISSING;
    if (Object.keys(problems).length) {
      setErrors(problems);
      focusField(Object.keys(problems)[0]);
      return;
    }
    setErrors({});

    const fields: Record<string, string> = {};
    for (const f of topic.fields) {
      const v = (f.key === "website" ? form.querySelector<HTMLInputElement>(`[name="${xName("website")}"]`)?.value : extras[f.key])?.trim();
      if (v) fields[f.key] = v;
    }

    setBusy(true);
    try {
      await contactApi.send({
        topic: topic.key,
        name,
        email,
        message,
        fields,
        on_air_ok: onAir,
        page_ref: extras.page || null,
        turnstileToken: token!,
        company_url: honeypot,
      });
      setMessage("");
      setExtras(initialExtras());
      setOnAir(false);
      setSent(topic.key);
    } catch (err) {
      const friendly = (err instanceof ApiError && err.friendly) || "Something went wrong sending your message. Please try again.";
      const field = err instanceof ApiError ? err.field : undefined;
      const formField =
        field === "name" || field === "email" || field === "message" || field === "turnstile"
          ? field
          : field && topic.fields.some((f) => f.key === field)
            ? xName(field)
            : null;
      if (formField) {
        setErrors({ [formField]: friendly });
        focusField(formField);
      } else {
        setFormError(friendly);
      }
    } finally {
      setBusy(false);
      turnstile.current?.reset(); // tokens are single-use
    }
  };

  const sendAnother = () => {
    refocusMessage.current = true;
    setSent(null);
  };

  const err = (field: string) =>
    errors[field] ? (
      <p id={`c3p-err-${field}`} className="c3p-error" role="alert">
        {errors[field]}
      </p>
    ) : null;
  const described = (field: string, ...more: string[]) => [errors[field] ? `c3p-err-${field}` : "", ...more].filter(Boolean).join(" ") || undefined;

  const extraInput = (f: ExtraField) => {
    const n = xName(f.key);
    return (
      <label key={f.key} className={`c3p-field${f.narrow ? " is-narrow" : ""}`}>
        <span className="c3p-label">
          {f.label}
          {!f.required && <span className="c3p-optional"> (optional)</span>}
        </span>
        <input
          className="c3p-input"
          name={n}
          type={f.type ?? "text"}
          inputMode={f.inputMode}
          pattern={f.inputMode === "numeric" ? "[0-9]{1,6}" : undefined}
          required={f.required}
          maxLength={200}
          placeholder={f.placeholder}
          autoComplete={f.autoComplete ?? "off"}
          value={extras[f.key] ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            setExtras((x) => ({ ...x, [f.key]: value }));
            clearError(n);
          }}
          aria-invalid={!!errors[n] || undefined}
          aria-describedby={described(n)}
        />
        {err(n)}
      </label>
    );
  };

  if (sent) {
    const t = topicByKey(sent);
    return (
      <div className="c3p-form-card c3p-sent">
        <div className="c3p-sent-badge" aria-hidden="true">
          <span className="c3p-sent-ring" />
          <span className="c3p-sent-ring" />
          <span className="c3p-sent-ring" />
          <span className="c3p-sent-dot">
            <IconCheck size={44} />
          </span>
        </div>
        <p className="c3p-sent-kicker">{lineLabel(t)} · Message received</p>
        <h3 ref={sentHeading} tabIndex={-1} className="c3p-sent-h">
          It's on the <br />
          studio desk.
        </h3>
        <p className="c3p-sent-text">
          Thank you. We've sent a confirmation to your email. If you asked a question, the reply will come from {CONTACT_EMAIL}, so keep an eye on
          your inbox.
        </p>
        <div className="c3p-sent-btns">
          <Link to="/" className="c3p-btn c3p-btn-red">
            <span aria-hidden="true">▶</span> Back to the radio
          </Link>
          <button type="button" className="c3p-btn c3p-btn-ghost" onClick={sendAnother}>
            Send another message
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} className="c3p-form-card" onSubmit={onSubmit} noValidate aria-labelledby="c3p-form-h">
      <div className="c3p-form-head">
        <div>
          <p className="c3p-eyebrow">Step 2 · Your message</p>
          <h3 id="c3p-form-h" className="c3p-h3">
            {topic.heading}
          </h3>
        </div>
        <span className="c3p-line-pill">
          <i className="c3p-led is-on" aria-hidden="true" />
          {lineLabel(topic)} · {topic.short}
        </span>
      </div>

      <div className="c3p-fields">
        <label className="c3p-field">
          <span className="c3p-label">Your name</span>
          <input
            className="c3p-input"
            name="name"
            required
            maxLength={80}
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearError("name");
            }}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={described("name")}
          />
          {err("name")}
        </label>
        <label className="c3p-field">
          <span className="c3p-label">Email address</span>
          <input
            className="c3p-input"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
            aria-invalid={!!errors.email || undefined}
            aria-describedby={described("email")}
          />
          {err("email")}
        </label>

        {topic.fields.map(extraInput)}

        {topic.key === "request" && (
          <p className="c3p-field is-full c3p-onair-note">
            Want to say it in your own voice? <Link to="/on-air">Record it here.</Link>
          </p>
        )}

        <label className="c3p-field is-full">
          <span className="c3p-label">Your message</span>
          <textarea
            className="c3p-input c3p-textarea"
            name="message"
            rows={7}
            required
            minLength={MESSAGE_MIN}
            maxLength={MESSAGE_MAX}
            placeholder={topic.placeholder}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              clearError("message");
            }}
            aria-invalid={!!errors.message || undefined}
            aria-describedby={described("message", "c3p-count")}
          />
          <LevelMeter length={message.length} max={MESSAGE_MAX} countId="c3p-count" />
          {err("message")}
        </label>
      </div>

      <label className="c3p-onair">
        <input type="checkbox" checked={onAir} onChange={(e) => setOnAir(e.target.checked)} />
        <span>
          <span className="c3p-onair-q">Happy for us to read this out on air?</span>
          <span className="c3p-onair-note">We'd only ever use your first name. Leave it unticked and your message stays private.</span>
        </span>
      </label>

      <label className="tc-hp" aria-hidden="true">
        Company website
        <input name="company_url" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </label>

      {formError && (
        <p className="c3p-error c3p-form-error" role="alert">
          {formError}
        </p>
      )}

      <div className="c3p-send-row">
        <div className="c3p-turnstile" data-field="turnstile" tabIndex={-1}>
          <Turnstile
            ref={turnstile}
            action="contact"
            onToken={(t) => {
              setToken(t);
              // Only our own "complete the check" hint goes away by itself. The widget renews its
              // token after every attempt, which mustn't wipe the server's answer before it's read.
              if (t) setErrors((e) => (e.turnstile === TURNSTILE_MISSING ? (({ turnstile: _, ...rest }) => rest)(e) : e));
            }}
          />
          {err("turnstile")}
        </div>
        <button type="submit" className="c3p-btn c3p-btn-red c3p-btn-lg c3p-send" disabled={busy}>
          {busy ? (
            <>
              <span className="c3p-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Sending…
            </>
          ) : (
            <>
              Send to the studio <IconSend />
            </>
          )}
        </button>
      </div>

      <p className="c3p-fine">
        We use your details only to reply to you. See our <Link to="/privacy">privacy notice</Link>.
      </p>
    </form>
  );
}
