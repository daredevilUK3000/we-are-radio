import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { contestApi, ApiError, type ContestState } from "../../../../api/client";
import { countriesByName } from "../../../../shared/countries";
import { Turnstile, type TurnstileHandle } from "../../../../shared/Turnstile";
import { useExclusiveAudio } from "../../../lib/audioUtils";
import { parisDay } from "../common";
import { IconCamera, IconCheck, IconLock, IconMail, IconMusic, IconPause, IconPlay, IconUpload, IconWarn, IconArrow } from "./icons";
import { MiniWave, SongPagePreview } from "./SongPagePreview";
import { ListenWhileYouEnter, TrustList } from "./ListenWhileYouEnter";
import type { useStationBridge } from "./useStationBridge";

/**
 * The entry form as a four-step wizard, plus the aside (live song-page
 * preview, the station, trust list).
 *
 * The logic is the one from the previous single-page form, moved here
 * unchanged: readDuration, pickAudio, pickPhoto, the submit checks, the
 * FormData it sends, the error-to-field mapping, the honeypot, Turnstile and
 * its reset. What's new is presentation - steps, the dropzone, previews - and
 * checking each step's fields on Continue rather than all at once at the end.
 *
 * It's still one <form>, and every step panel stays mounted (only the
 * current one is shown), so typed values and chosen files survive Back/Next.
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

const STEPS = ["Your song", "About you", "Private details", "Declarations"] as const;
type Step = 1 | 2 | 3 | 4;

// Which step a field lives on, so a problem (ours or the server's) opens the right step.
const FIELD_STEP: Record<string, Step> = {
  audio: 1,
  title: 1,
  creator_name: 1,
  country_code: 1,
  created_or_released: 1,
  bio: 2,
  photo: 2,
  links: 2,
  legal_name: 3,
  email: 3,
};
const stepOf = (field: string): Step => FIELD_STEP[field] ?? 4;

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

/** An object URL for a local file, revoked when the file changes or the component goes away. */
function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function EntryWizard({ state, station }: { state: ContestState; station: ReturnType<typeof useStationBridge> }) {
  const countries = useMemo(() => countriesByName(), []);

  // ---- form state (unchanged from the single-page form) ----
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

  // ---- wizard-only state ----
  const [step, setStep] = useState<Step>(1);
  const [reached4, setReached4] = useState(false); // Turnstile mounts once step 4 is first shown, then stays
  const [announce, setAnnounce] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const panels = useRef<Record<number, HTMLDivElement | null>>({});
  const headings = useRef<Record<number, HTMLHeadingElement | null>>({});
  const stepChanged = useRef(false);
  const audioUrl = useObjectUrl(audio);
  const photoUrl = useObjectUrl(photo);

  // The entrant's own MP3 preview pauses the station (and the station pauses it).
  useExclusiveAudio("entry-preview", previewRef, !!audioUrl, () => setPreviewPlaying(false));

  const set = (name: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields((f) => ({ ...f, [name]: e.target.value }));

  // A problem opens its step, then scrolls the first one into view.
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (!first) return;
    setStep(stepOf(first));
    requestAnimationFrame(() =>
      formRef.current?.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  }, [errors]);

  useEffect(() => {
    if (step === 4) setReached4(true);
    if (!stepChanged.current) return;
    headings.current[step]?.focus({ preventScroll: true });
    setAnnounce(`Step ${step} of 4, ${STEPS[step - 1]}`);
  }, [step]);

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

  // ---- per-step checks: the same messages as the final submit ----
  const customProblems = (n: Step): Record<string, string> => {
    const problems: Record<string, string> = {};
    if (n === 1) {
      if (checkingAudio) problems.audio = "Still checking your song file - one moment.";
      else if (!audio) problems.audio = errors.audio ?? "Please choose your song's MP3 file.";
    }
    if (n === 2 && errors.photo) problems.photo = errors.photo;
    if (n === 4) {
      if (!usedAi) problems.ai_tools = "Please tell us whether you used any AI tools.";
      if (usedAi === "yes" && !fields.ai_tools.trim()) problems.ai_tools = "Please name the AI tools you used.";
      if (!inSociety) problems.collecting_society = "Please tell us whether you're a member of a collecting society.";
      if (inSociety === "yes" && !fields.collecting_society.trim()) problems.collecting_society = "Please name your collecting society.";
      const missing = DECLARATIONS.find((d) => !ticks[d.name]);
      if (missing) problems[missing.name] = "Please tick all five declarations to enter.";
      if (!token) problems.turnstile = "Please complete the check above the button.";
    }
    return problems;
  };

  // The browser's own required/format checks for one panel. Works on hidden panels too.
  const nativeValid = (n: Step) => {
    const panel = panels.current[n];
    if (!panel) return true;
    return Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")).every(
      (el) => el.checkValidity()
    );
  };

  /** Checks steps from..to; on the first failure opens that step and shows why. */
  const validateSteps = (from: Step, to: Step): boolean => {
    for (let n = from; n <= to; n++) {
      const s = n as Step;
      const problems = customProblems(s);
      const native = nativeValid(s);
      if (!native || Object.keys(problems).length) {
        stepChanged.current = true;
        if (Object.keys(problems).length) setErrors(problems);
        else setErrors({});
        setStep(s);
        // Once visible, let the browser point at its own complaint.
        if (!native) requestAnimationFrame(() => reportPanel(s));
        return false;
      }
    }
    return true;
  };
  const reportPanel = (n: Step) => {
    const invalid = panels.current[n]?.querySelector<HTMLInputElement>("input:invalid, select:invalid, textarea:invalid");
    invalid?.reportValidity();
  };

  const goTo = (target: Step) => {
    if (target === step) return;
    if (target < step) {
      stepChanged.current = true;
      setStep(target);
      return;
    }
    if (validateSteps(step, (target - 1) as Step)) {
      stepChanged.current = true;
      setErrors({});
      setStep(target);
    }
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
      previewRef.current?.pause();
      setSent(true);
      requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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

  // Enter in a field means Continue until the last step. The browser's own
  // whole-form validation is off (noValidate) because it can't point at a
  // field on a hidden step; each step is checked explicitly instead.
  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 4) return goTo((step + 1) as Step);
    if (!validateSteps(1, 3) || !nativeValid(4)) {
      if (!nativeValid(4)) reportPanel(4);
      return;
    }
    void submit(e);
  };

  const togglePreview = () => {
    const el = previewRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) el.play().then(() => setPreviewPlaying(true), () => setPreviewPlaying(false));
    else el.pause();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void pickAudio(file);
  };

  // ---- render ----
  const open = state.phase === "entries_open" || state.studioPreview;
  const busy = progress !== null;
  const fieldError = (name: string) =>
    errors[name] && (
      <p className="t3p-error" role="alert">
        {errors[name]}
      </p>
    );
  const complete = (n: Step) => n < step && Object.keys(customProblems(n)).length === 0 && nativeValid(n);
  const lowQuality = bitrateKbps !== null && bitrateKbps < LOW_BITRATE_KBPS;

  const aside = (
    <aside className="t3p-aside">
      <SongPagePreview
        title={fields.title}
        creator={fields.creator_name}
        countryCode={fields.country_code}
        photoUrl={photoUrl}
        votingOpenLabel={parisDay(state.dates.votingOpen)}
      />
      <ListenWhileYouEnter station={station} />
      <TrustList />
    </aside>
  );

  if (!open) {
    return (
      <div className="t3p-enter-grid">
        <div className="t3p-card t3p-closed">
          <h3 className="t3p-step-h">{state.phase === "before_entries" ? `Entries open ${parisDay(state.dates.entriesOpen)}` : "Entries are closed"}</h3>
          <p>
            {state.phase === "before_entries"
              ? `You'll be able to enter your 2026 song here from ${parisDay(state.dates.entriesOpen)} until ${parisDay(state.dates.entriesClose)}.`
              : `Entries closed on ${parisDay(state.dates.entriesClose)}. Thank you to every Creator who entered.`}
          </p>
          <Link to={state.phase === "before_entries" ? "/top3/rules" : "/top3"} className="t3p-btn t3p-btn-red">
            {state.phase === "before_entries" ? "Read the rules" : "Browse the songs"} <IconArrow />
          </Link>
        </div>
        {aside}
      </div>
    );
  }

  return (
    <div className="t3p-enter-grid">
      <div className="t3p-card t3p-form-card" ref={cardRef}>
        {sent ? (
          <div className="t3p-sent">
            <div className="t3p-sent-icon" aria-hidden="true">
              <span />
              <span />
              <IconMail />
            </div>
            <h3 className="t3p-sent-h">Check your email</h3>
            <p>
              We've sent you a link to confirm your entry at <strong>{fields.email}</strong>. Once you click it, your song goes into
              review, and we'll email you within 14 days.
            </p>
            <p className="t3p-fine">The link works for 7 days. Can't see it? Check your spam or promotions folder.</p>
            <Link to="/top3" className="t3p-btn t3p-btn-ghost">
              Back to the Top 3
            </Link>
          </div>
        ) : (
          <form className="t3p-form" onSubmit={onFormSubmit} ref={formRef} noValidate>
            <ol className="t3p-stepper">
              {STEPS.map((label, i) => {
                const n = (i + 1) as Step;
                const done = complete(n);
                return (
                  <li key={label} className={`${n === step ? "is-current" : ""}${done ? " is-done" : ""}`}>
                    <button type="button" onClick={() => goTo(n)} aria-current={n === step ? "step" : undefined} disabled={busy}>
                      <span className="t3p-stepper-bar" />
                      <span className="t3p-stepper-label">
                        <span className="t3p-stepper-num">0{n}</span> {label}
                        {done && <IconCheck className="t3p-stepper-check" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="t3p-stepper-phone">
              Step {step} of 4 · {STEPS[step - 1]}
            </p>
            <p className="t3p-sr" aria-live="polite">
              {announce}
            </p>

            {/* ---------------- Step 1 ---------------- */}
            <div className="t3p-step" hidden={step !== 1} ref={(el) => (panels.current[1] = el)}>
              <div className="t3p-step-head">
                <h3 className="t3p-step-h" tabIndex={-1} ref={(el) => (headings.current[1] = el)}>
                  Your song
                </h3>
                <p>Created or first released between 1 January and 31 December 2026.</p>
              </div>

              <input
                ref={audioInput}
                id="t3p-audio"
                className="t3p-visually-hidden"
                type="file"
                accept="audio/mpeg,.mp3"
                onChange={(e) => {
                  void pickAudio(e.target.files?.[0] ?? null);
                  e.target.value = ""; // so choosing the same file again still counts
                }}
                disabled={busy}
              />
              <div data-field="audio">
                {!audio ? (
                  <label
                    htmlFor="t3p-audio"
                    className={`t3p-drop${dragging ? " is-dragging" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    <span className="t3p-drop-icon">
                      <IconUpload />
                    </span>
                    <span className="t3p-drop-title">
                      <span className="t3p-desktop-only">Drop your MP3 here, or browse</span>
                      <span className="t3p-mobile-only">Choose your MP3</span>
                    </span>
                    <span className="t3p-drop-specs">
                      <span className="t3p-desktop-only">MP3 · up to 20 MB · up to 8 minutes · 192 kbps or higher recommended</span>
                      <span className="t3p-mobile-only">Up to 20 MB and 8 minutes</span>
                    </span>
                    {checkingAudio && <span className="t3p-drop-checking">Checking your file...</span>}
                  </label>
                ) : (
                  <div className="t3p-file">
                    <div className="t3p-file-top">
                      <span className="t3p-file-icon">
                        <IconMusic />
                      </span>
                      <div className="t3p-file-name">
                        <strong title={audio.name}>{audio.name}</strong>
                        <span>Ready to upload · {(audio.size / MB).toFixed(1)} MB</span>
                      </div>
                      <button
                        type="button"
                        className="t3p-mini-btn"
                        onClick={togglePreview}
                        aria-label={previewPlaying ? "Pause preview" : "Preview your song"}
                        aria-pressed={previewPlaying}
                      >
                        {previewPlaying ? <IconPause size={14} /> : <IconPlay size={14} />}
                        <span>{previewPlaying ? "Pause" : "Preview"}</span>
                      </button>
                      <button type="button" className="t3p-mini-btn t3p-mini-ghost" onClick={() => audioInput.current?.click()} disabled={busy}>
                        Replace
                      </button>
                    </div>
                    <MiniWave count={96} seed={audio.size} className="t3p-wave t3p-wave-file" />
                    <div className="t3p-chips">
                      <span className="t3p-chip is-ok">
                        <IconCheck /> MP3
                      </span>
                      {duration ? (
                        <span className="t3p-chip is-ok">
                          <IconCheck /> {clock(duration)}
                        </span>
                      ) : (
                        <span className="t3p-chip">Length unknown</span>
                      )}
                      {bitrateKbps !== null &&
                        (lowQuality ? (
                          <span className="t3p-chip is-warn">
                            <IconWarn /> Low sound quality
                          </span>
                        ) : (
                          <span className="t3p-chip is-ok">
                            <IconCheck /> {bitrateKbps} kbps
                          </span>
                        ))}
                    </div>
                    {lowQuality && (
                      <p className="t3p-warn">
                        This file looks low quality (about {bitrateKbps} kbps). If you have a higher-quality MP3 (192 kbps or more), use
                        that - it's what goes out on air.
                      </p>
                    )}
                    {audioUrl && <audio ref={previewRef} src={audioUrl} onPause={() => setPreviewPlaying(false)} onEnded={() => setPreviewPlaying(false)} />}
                  </div>
                )}
                {fieldError("audio")}
              </div>

              <div className="t3p-grid">
                <label className="t3p-field" data-field="title">
                  <span>Song title</span>
                  <input value={fields.title} onChange={set("title")} maxLength={120} required placeholder="e.g. Midnight in the City" />
                  {fieldError("title")}
                </label>
                <label className="t3p-field" data-field="creator_name">
                  <span>Creator name, as it should appear</span>
                  <input value={fields.creator_name} onChange={set("creator_name")} maxLength={80} required />
                  {fieldError("creator_name")}
                </label>
                <label className="t3p-field" data-field="country_code">
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
                <label className="t3p-field" data-field="created_or_released">
                  <span>Date created or first released</span>
                  <input
                    type="date"
                    value={fields.created_or_released}
                    onChange={set("created_or_released")}
                    min={state.dates.eligibleFrom}
                    max={state.dates.eligibleTo}
                    required
                  />
                  {fieldError("created_or_released")}
                </label>
              </div>
            </div>

            {/* ---------------- Step 2 ---------------- */}
            <div className="t3p-step" hidden={step !== 2} ref={(el) => (panels.current[2] = el)}>
              <div className="t3p-step-head">
                <h3 className="t3p-step-h" tabIndex={-1} ref={(el) => (headings.current[2] = el)}>
                  About you
                </h3>
                <p>Optional, and shown on your song page. A photo and a few words help listeners connect with you.</p>
              </div>
              <div className="t3p-about-row">
                <div data-field="photo">
                  <input
                    ref={photoInput}
                    id="t3p-photo"
                    className="t3p-visually-hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      pickPhoto(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                    disabled={busy}
                  />
                  {photoUrl ? (
                    <div className="t3p-photo is-filled">
                      <img src={photoUrl} alt="Your photo" />
                      <button type="button" className="t3p-photo-change" onClick={() => photoInput.current?.click()} disabled={busy}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <label htmlFor="t3p-photo" className="t3p-photo">
                      <IconCamera />
                      <span>Add a photo</span>
                    </label>
                  )}
                  {fieldError("photo")}
                </div>
                <label className="t3p-field t3p-bio" data-field="bio">
                  <span>Short bio</span>
                  <textarea value={fields.bio} onChange={(e) => setFields((f) => ({ ...f, bio: e.target.value.slice(0, 300) }))} rows={5} />
                  <small>{fields.bio.length} / 300</small>
                  {fieldError("bio")}
                </label>
              </div>
              <div className="t3p-field" data-field="links">
                <span>
                  Links to your music or socials <em>· Up to 3</em>
                </span>
                <div className="t3p-links">
                  {(["link1", "link2", "link3"] as const).map((k, i) => (
                    <input
                      key={k}
                      type="url"
                      value={fields[k]}
                      onChange={set(k)}
                      placeholder="https://"
                      maxLength={300}
                      pattern="https://.*"
                      aria-label={`Link ${i + 1}`}
                    />
                  ))}
                </div>
                {fieldError("links")}
              </div>
            </div>

            {/* ---------------- Step 3 ---------------- */}
            <div className="t3p-step" hidden={step !== 3} ref={(el) => (panels.current[3] = el)}>
              <div className="t3p-step-head">
                <h3 className="t3p-step-h" tabIndex={-1} ref={(el) => (headings.current[3] = el)}>
                  Private details
                </h3>
                <p>So we can reach you about your entry, and if you win.</p>
              </div>
              <p className="t3p-infobar">
                <IconLock /> Never published. Used only to contact you about the competition.
              </p>
              <div className="t3p-grid">
                <label className="t3p-field" data-field="legal_name">
                  <span>Your legal name</span>
                  <input value={fields.legal_name} onChange={set("legal_name")} maxLength={120} required autoComplete="name" />
                  {fieldError("legal_name")}
                </label>
                <label className="t3p-field" data-field="email">
                  <span>Email address</span>
                  <input type="email" value={fields.email} onChange={set("email")} maxLength={254} required autoComplete="email" />
                  {fieldError("email")}
                </label>
              </div>
              <p className="t3p-fine">
                We'll email you a link to confirm your entry. It goes to review once you click it, and must be confirmed within 7 days.
              </p>
            </div>

            {/* ---------------- Step 4 ---------------- */}
            <div className="t3p-step" hidden={step !== 4} ref={(el) => (panels.current[4] = el)}>
              <div className="t3p-step-head">
                <h3 className="t3p-step-h" tabIndex={-1} ref={(el) => (headings.current[4] = el)}>
                  Declarations
                </h3>
                <p>Two quick questions, then confirm the rules.</p>
              </div>

              <fieldset className="t3p-fieldset" data-field="ai_tools">
                <legend>Did you use any AI tools to make this song?</legend>
                <div className="t3p-radios">
                  <label className="t3p-radio">
                    <input type="radio" name="usedAi" checked={usedAi === "no"} onChange={() => setUsedAi("no")} /> No
                  </label>
                  <label className="t3p-radio">
                    <input type="radio" name="usedAi" checked={usedAi === "yes"} onChange={() => setUsedAi("yes")} /> Yes
                  </label>
                </div>
                {usedAi === "yes" && (
                  <input
                    className="t3p-input"
                    value={fields.ai_tools}
                    onChange={set("ai_tools")}
                    maxLength={200}
                    placeholder="If yes, which tools, and what for?"
                    aria-label="Which AI tools, and what for"
                  />
                )}
                {fieldError("ai_tools")}
              </fieldset>

              <fieldset className="t3p-fieldset" data-field="collecting_society">
                <legend>Are you a member of a collecting society (SACEM, PRS, ASCAP, BMI...)?</legend>
                <div className="t3p-radios">
                  <label className="t3p-radio">
                    <input type="radio" name="inSociety" checked={inSociety === "no"} onChange={() => setInSociety("no")} /> No
                  </label>
                  <label className="t3p-radio">
                    <input type="radio" name="inSociety" checked={inSociety === "yes"} onChange={() => setInSociety("yes")} /> Yes
                  </label>
                </div>
                {inSociety === "yes" && (
                  <input
                    className="t3p-input"
                    value={fields.collecting_society}
                    onChange={set("collecting_society")}
                    maxLength={60}
                    placeholder="If yes, which society?"
                    aria-label="Which collecting society"
                  />
                )}
                {fieldError("collecting_society")}
              </fieldset>

              <div className="t3p-declarations">
                {DECLARATIONS.map((d) => (
                  <label key={d.name} className="t3p-check" data-field={d.name}>
                    <input type="checkbox" checked={!!ticks[d.name]} onChange={(e) => setTicks((t) => ({ ...t, [d.name]: e.target.checked }))} />
                    <span>{d.label}</span>
                  </label>
                ))}
                {DECLARATIONS.map((d) => errors[d.name] && <p key={d.name} className="t3p-error" role="alert">{errors[d.name]}</p>).find(Boolean)}
              </div>

              <label className="tc-hp" aria-hidden="true">
                Website
                <input tabIndex={-1} autoComplete="off" value={fields.website} onChange={set("website")} />
              </label>

              <div data-field="turnstile" className="t3p-turnstile">
                {reached4 && <Turnstile ref={turnstile} action="entry" onToken={setToken} />}
                {fieldError("turnstile")}
              </div>
            </div>

            {formError && (
              <p className="t3p-error t3p-form-error" role="alert">
                {formError}
              </p>
            )}

            {busy && (
              <div className="t3p-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.round(progress! * 100)}%` }} />
                <span>{progress! < 1 ? `Uploading... ${Math.round(progress! * 100)}%` : "Saving your entry..."}</span>
              </div>
            )}

            <div className="t3p-nav">
              {step > 1 ? (
                <button type="button" className="t3p-btn t3p-btn-ghost t3p-btn-sm" onClick={() => goTo((step - 1) as Step)} disabled={busy}>
                  Back
                </button>
              ) : (
                <span />
              )}
              <span className="t3p-nav-count">Step {step} of 4</span>
              {step < 4 ? (
                <button type="submit" className="t3p-btn t3p-btn-red t3p-btn-sm">
                  Continue <IconArrow />
                </button>
              ) : (
                <button type="submit" className="t3p-btn t3p-btn-red t3p-btn-submit" disabled={busy}>
                  {busy ? "Sending..." : "Submit my entry"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      {aside}
    </div>
  );
}
