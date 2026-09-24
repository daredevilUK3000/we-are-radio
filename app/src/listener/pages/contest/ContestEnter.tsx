import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { contestApi, ApiError } from "../../../api/client";
import { countriesByName } from "../../../shared/countries";
import { Turnstile, type TurnstileHandle } from "../../../shared/Turnstile";
import { CONTEST_TITLE, parisDay, useContestState } from "../../components/contest/common";

/**
 * /top3/enter - the entry form. Everything is checked again on the server
 * (worker/src/routes/contest.ts); the checks here are for the entrant's sake,
 * so a too-long song or a WAV is caught before a 20 MB upload rather than after.
 *
 * On success the entry is "unconfirmed" until they click the link in the
 * email we send - it isn't reviewed before then.
 */

const MB = 1024 * 1024;
const LOW_BITRATE_KBPS = 180;

const DECLARATIONS: { name: string; label: React.ReactNode }[] = [
  { name: "confirm_age", label: "I am 18 or over." },
  { name: "confirm_independent", label: "I am an Independent Creator: no record label or publishing deal controls this song." },
  { name: "confirm_rights", label: "This song is my original work and contains nothing I don't have the right to use." },
  { name: "confirm_licence", label: "I grant We Are Radio the licence described in section 7 of the rules." },
  {
    name: "accept_rules",
    label: (
      <>
        I have read and accept the{" "}
        <Link to="/top3/rules" target="_blank">
          official rules
        </Link>{" "}
        and privacy terms.
      </>
    ),
  },
];

/** Reads an audio file's length in the browser, without uploading it. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 8000); // an unreadable length is checked by the reviewer instead
    audio.src = url;
  });
}

export function ContestEnter() {
  const { state, error: stateError } = useContestState();
  const countries = useMemo(() => countriesByName(), []);

  const [audio, setAudio] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [checkingAudio, setCheckingAudio] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [fields, setFields] = useState({
    title: "",
    creator_name: "",
    country_code: "",
    created_or_released: "",
    bio: "",
    link1: "",
    link2: "",
    link3: "",
    legal_name: "",
    email: "",
    ai_tools: "",
    collecting_society: "",
    website: "", // honeypot: hidden from people, tempting to bots
  });
  const [usedAi, setUsedAi] = useState<"" | "no" | "yes">("");
  const [inSociety, setInSociety] = useState<"" | "no" | "yes">("");
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [token, setToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = (name: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields((f) => ({ ...f, [name]: e.target.value }));

  // Scroll the first problem into view after a failed submit.
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first) formRef.current?.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [errors]);

  const bitrateKbps = audio && duration ? Math.round((audio.size * 8) / duration / 1000) : null;

  const pickAudio = async (file: File | null) => {
    setAudio(null);
    setDuration(null);
    setErrors(({ audio: _, ...rest }) => rest);
    if (!file) return;
    const looksMp3 = file.type === "audio/mpeg" || file.type === "audio/mp3" || /\.mp3$/i.test(file.name);
    if (!looksMp3) return setErrors((e) => ({ ...e, audio: "Please upload your song as an MP3." }));
    if (file.size > 20 * MB) return setErrors((e) => ({ ...e, audio: "Songs can be up to 20 MB." }));
    setCheckingAudio(true);
    const seconds = await readDuration(file);
    setCheckingAudio(false);
    if (seconds && seconds > 8 * 60) return setErrors((e) => ({ ...e, audio: "Songs can be up to 8 minutes long." }));
    setAudio(file);
    setDuration(seconds);
  };

  const pickPhoto = (file: File | null) => {
    setPhoto(null);
    setErrors(({ photo: _, ...rest }) => rest);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return setErrors((e) => ({ ...e, photo: "Photos must be a JPEG, PNG or WebP image." }));
    if (file.size > 5 * MB) return setErrors((e) => ({ ...e, photo: "Photos can be up to 5 MB." }));
    setPhoto(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const problems: Record<string, string> = {};
    if (checkingAudio) problems.audio = "Still checking your song file - one moment.";
    else if (!audio) problems.audio = errors.audio ?? "Please choose your song's MP3 file.";
    if (errors.photo) problems.photo = errors.photo;
    if (!usedAi) problems.ai_tools = "Please tell us whether you used any AI tools.";
    if (usedAi === "yes" && !fields.ai_tools.trim()) problems.ai_tools = "Please name the AI tools you used.";
    if (!inSociety) problems.collecting_society = "Please tell us whether you're a member of a collecting society.";
    if (inSociety === "yes" && !fields.collecting_society.trim()) problems.collecting_society = "Please name your collecting society.";
    const missing = DECLARATIONS.find((d) => !ticks[d.name]);
    if (missing) problems[missing.name] = "Please tick all five declarations to enter.";
    if (!token) problems.turnstile = "Please complete the check above the button.";
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    setErrors({});

    const form = new FormData();
    form.append("audio", audio!);
    if (photo) form.append("photo", photo);
    for (const name of ["title", "creator_name", "country_code", "created_or_released", "bio", "legal_name", "email", "website"] as const) {
      form.append(name, fields[name]);
    }
    form.append("ai_tools", usedAi === "yes" ? fields.ai_tools : "");
    form.append("collecting_society", inSociety === "yes" ? fields.collecting_society : "");
    for (const l of [fields.link1, fields.link2, fields.link3]) if (l.trim()) form.append("links", l.trim());
    if (duration) form.append("duration_seconds", String(Math.round(duration)));
    for (const d of DECLARATIONS) form.append(d.name, ticks[d.name] ? "1" : "0");
    form.append("turnstileToken", token!);

    setProgress(0);
    try {
      await contestApi.submitEntry(form, setProgress);
      setSent(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const friendly = (err instanceof ApiError && err.friendly) || "Something went wrong sending your entry. Please try again.";
      const field = err instanceof ApiError ? err.field : undefined;
      if (err instanceof ApiError && err.code === "entry_limit") {
        setFormError(err instanceof ApiError && err.friendly ? err.friendly : "You've already entered a song.");
      } else if (field && field !== "turnstile") {
        setErrors({ [field]: friendly });
      } else {
        setFormError(friendly);
      }
    } finally {
      setProgress(null);
      turnstile.current?.reset(); // tokens are single-use
    }
  };

  if (sent) {
    return (
      <div className="tc">
        <span className="rfy-eyebrow">Top 3 Creator Songs of 2026</span>
        <h1 className="rfy-h1">Check your email</h1>
        <div className="tc-card">
          <p className="tc-sent-line">
            We've sent a link to <strong>{fields.email}</strong>. Click it to confirm your entry. It won't be reviewed until you do.
          </p>
          <p className="tc-fine">
            The link works for 7 days. Can't see it? Check your spam or promotions folder. Once it's confirmed, we'll review your
            song within 14 days and email you either way.
          </p>
          <Link to="/top3" className="pill-btn pill-btn-ghost">
            Back to the Top 3
          </Link>
        </div>
      </div>
    );
  }

  if (stateError) return <p className="tc-error">Couldn't load the competition right now. Please try again in a minute.</p>;
  if (!state) return <p>Loading...</p>;

  const open = state.phase === "entries_open" || state.studioPreview;
  if (!open) {
    return (
      <div className="tc">
        <span className="rfy-eyebrow">Top 3 Creator Songs of 2026</span>
        <h1 className="rfy-h1">{state.phase === "before_entries" ? `Entries open ${parisDay(state.dates.entriesOpen)}` : "Entries are closed"}</h1>
        <p className="rfy-lede">
          {state.phase === "before_entries"
            ? `You'll be able to enter your 2026 song here from ${parisDay(state.dates.entriesOpen)} until ${parisDay(state.dates.entriesClose)}.`
            : `Entries closed on ${parisDay(state.dates.entriesClose)}. Thank you to every Creator who entered.`}
        </p>
        <Link to="/top3" className="pill-btn pill-btn-solid">
          Back to the Top 3
        </Link>
      </div>
    );
  }

  const busy = progress !== null;
  const fieldError = (name: string) => errors[name] && <p className="tc-error t3-field-error">{errors[name]}</p>;

  return (
    <div className="tc">
      <span className="rfy-eyebrow">{CONTEST_TITLE}</span>
      <h1 className="rfy-h1">Enter your song</h1>
      <p className="rfy-lede">
        {state.limits.maxEntriesPerEntrant === 1
          ? "One 2026 song per creator."
          : `One 2026 song per entry, up to ${state.limits.maxEntriesPerEntrant} entries each.`}{" "}
        Entries close {parisDay(state.dates.entriesClose)}.
      </p>
      {state.phase === "before_entries" && (
        <p className="t3-preview-note">
          Studio preview: entries aren't open to the public yet. Remember to withdraw test entries in the Studio before 1 October.
        </p>
      )}

      <form className="tc-card t3-form" onSubmit={submit} ref={formRef} noValidate={false}>
        <h2 className="t3-form-h">Your song</h2>
        <label className="tc-field" data-field="audio">
          <span>Your song (MP3, up to 20 MB and 8 minutes)</span>
          <input type="file" accept=".mp3,audio/mpeg" onChange={(e) => pickAudio(e.target.files?.[0] ?? null)} disabled={busy} />
          {checkingAudio && <small>Checking your file...</small>}
          {audio && (
            <small>
              {(audio.size / MB).toFixed(1)} MB
              {duration ? ` · ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, "0")}` : ""}
              {bitrateKbps ? ` · about ${bitrateKbps} kbps` : ""}
            </small>
          )}
          {bitrateKbps !== null && bitrateKbps < LOW_BITRATE_KBPS && (
            <small className="t3-warn">
              This file looks low quality (about {bitrateKbps} kbps). If you have a higher-quality MP3 (192 kbps or more), use that -
              it's what goes out on air.
            </small>
          )}
          {fieldError("audio")}
        </label>

        <div className="tc-grid">
          <label className="tc-field" data-field="title">
            <span>Song title</span>
            <input value={fields.title} onChange={set("title")} maxLength={120} required />
            {fieldError("title")}
          </label>
          <label className="tc-field" data-field="creator_name">
            <span>Creator name (as it should appear)</span>
            <input value={fields.creator_name} onChange={set("creator_name")} maxLength={80} required />
            {fieldError("creator_name")}
          </label>
          <label className="tc-field" data-field="country_code">
            <span>Country</span>
            <select value={fields.country_code} onChange={set("country_code")} required>
              <option value="">Choose...</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldError("country_code")}
          </label>
          <label className="tc-field" data-field="created_or_released">
            <span>Date created or first released</span>
            <input
              type="date"
              value={fields.created_or_released}
              onChange={set("created_or_released")}
              min={state.dates.eligibleFrom}
              max={state.dates.eligibleTo}
              required
            />
            <small>Must be in 2026.</small>
            {fieldError("created_or_released")}
          </label>
        </div>

        <h2 className="t3-form-h">About you (public)</h2>
        <label className="tc-field" data-field="bio">
          <span>Short bio (optional)</span>
          <textarea value={fields.bio} onChange={(e) => setFields((f) => ({ ...f, bio: e.target.value.slice(0, 300) }))} rows={3} />
          <small>{fields.bio.length} / 300</small>
          {fieldError("bio")}
        </label>
        <label className="tc-field" data-field="photo">
          <span>Photo (optional; JPEG, PNG or WebP, up to 5 MB)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} disabled={busy} />
          {fieldError("photo")}
        </label>
        <div className="tc-field" data-field="links">
          <span>Links (optional; up to 3, e.g. your website or streaming profiles)</span>
          {(["link1", "link2", "link3"] as const).map((k) => (
            <input key={k} type="url" value={fields[k]} onChange={set(k)} placeholder="https://" maxLength={300} pattern="https://.*" />
          ))}
          {fieldError("links")}
        </div>

        <h2 className="t3-form-h">Private details</h2>
        <p className="tc-fine">Never published. We use these only to contact you about your entry.</p>
        <div className="tc-grid">
          <label className="tc-field" data-field="legal_name">
            <span>Your full legal name</span>
            <input value={fields.legal_name} onChange={set("legal_name")} maxLength={120} required autoComplete="name" />
            {fieldError("legal_name")}
          </label>
          <label className="tc-field" data-field="email">
            <span>Email</span>
            <input type="email" value={fields.email} onChange={set("email")} maxLength={254} required autoComplete="email" />
            {fieldError("email")}
          </label>
        </div>

        <h2 className="t3-form-h">Declarations</h2>
        <div className="tc-field" data-field="ai_tools">
          <span>Did you use any AI tools to make this song?</span>
          <div className="t3-radio-row">
            <label className="t3-check">
              <input type="radio" name="usedAi" checked={usedAi === "no"} onChange={() => setUsedAi("no")} /> <span>No</span>
            </label>
            <label className="t3-check">
              <input type="radio" name="usedAi" checked={usedAi === "yes"} onChange={() => setUsedAi("yes")} /> <span>Yes</span>
            </label>
          </div>
          {usedAi === "yes" && (
            <input value={fields.ai_tools} onChange={set("ai_tools")} maxLength={200} placeholder="Which tools, and what for?" />
          )}
          {fieldError("ai_tools")}
        </div>
        <div className="tc-field" data-field="collecting_society">
          <span>Are you a member of a collecting society (e.g. SACEM, PRS, ASCAP)?</span>
          <div className="t3-radio-row">
            <label className="t3-check">
              <input type="radio" name="inSociety" checked={inSociety === "no"} onChange={() => setInSociety("no")} /> <span>No</span>
            </label>
            <label className="t3-check">
              <input type="radio" name="inSociety" checked={inSociety === "yes"} onChange={() => setInSociety("yes")} /> <span>Yes</span>
            </label>
          </div>
          {inSociety === "yes" && (
            <input value={fields.collecting_society} onChange={set("collecting_society")} maxLength={60} placeholder="Which society?" />
          )}
          {fieldError("collecting_society")}
        </div>

        <div className="t3-declarations">
          {DECLARATIONS.map((d) => (
            <label key={d.name} className="t3-check" data-field={d.name}>
              <input type="checkbox" checked={!!ticks[d.name]} onChange={(e) => setTicks((t) => ({ ...t, [d.name]: e.target.checked }))} />
              <span>{d.label}</span>
            </label>
          ))}
          {DECLARATIONS.map((d) => errors[d.name] && <p key={d.name} className="tc-error t3-field-error">{errors[d.name]}</p>).find(Boolean)}
        </div>

        <label className="tc-hp" aria-hidden="true">
          Website
          <input tabIndex={-1} autoComplete="off" value={fields.website} onChange={set("website")} />
        </label>

        <div data-field="turnstile">
          <Turnstile ref={turnstile} action="entry" onToken={setToken} />
          {fieldError("turnstile")}
        </div>

        {formError && <p className="tc-error">{formError}</p>}

        {busy && (
          <div className="t3-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            <span>{progress! < 1 ? `Uploading... ${Math.round(progress! * 100)}%` : "Saving your entry..."}</span>
          </div>
        )}

        <div className="tc-actions">
          <button type="submit" className="pill-btn pill-btn-solid" disabled={busy}>
            {busy ? "Sending..." : "Submit my entry"}
          </button>
        </div>
        <p className="tc-fine">
          After you submit, we'll email you a link to confirm your entry. Review takes up to 14 days once it's confirmed.
        </p>
      </form>
    </div>
  );
}
