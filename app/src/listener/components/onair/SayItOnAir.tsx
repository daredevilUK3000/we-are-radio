import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, publicApi } from "../../../api/client";
import { onAirApi, type OnAirKind } from "../../../api/onAir";
import { decodeToMono, encodeWav, peaks, resampleMono } from "../../../shared/wav";
import { Turnstile, type TurnstileHandle } from "../../../shared/Turnstile";
import { announceRecording } from "./recording";
import "./onair.css";

/**
 * "Say it on air": Record -> Listen back -> Details -> Sent. One component,
 * used as the /on-air page's recorder and as the bottom sheet the players
 * open. The recording is decoded, mixed to mono, resampled to 24 kHz and sent
 * as a 16-bit WAV (about 2 MB for 45 s): one format every Studio browser
 * can decode, and a predictable size on mobile data.
 */

const MAX_SECONDS = 45;
const MIN_SECONDS = 3;
/** Recorded before "go" (see start()); the server allows 46 s, so 45 s plus this fits. */
const PRE_ROLL_MS = 500;
const UPLOAD_RATE = 24_000;
const SEGMENTS = 24;
const WAVE_BARS = 64;

export interface OnAirNowPlaying {
  label: string | null;
  track_id: string | null;
  item_type: string | null;
}

type Step = "record" | "listen" | "details" | "sent";
type RecState = "idle" | "asking" | "countin" | "recording" | "converting";

const KINDS: { key: OnAirKind; label: string }[] = [
  { key: "shoutout", label: "Shout-out" },
  { key: "dedication", label: "Dedication" },
  { key: "reaction", label: "Your take on this song" },
  { key: "question", label: "Question for Kizzi" },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function MicLevel({ level }: { level: number }) {
  // level is an RMS 0..1; speech sits around 0.05-0.3, so the scale is stretched.
  const lit = Math.min(SEGMENTS, Math.round(Math.sqrt(Math.min(1, level * 3)) * SEGMENTS));
  return (
    <div className="oa-meter" aria-hidden="true">
      <span className="oa-meter-label">Level</span>
      <span className="oa-meter-bar">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const zone = i < 15 ? "g" : i < 20 ? "a" : "r";
          return <i key={i} className={i < lit ? `on ${zone}` : undefined} />;
        })}
      </span>
    </div>
  );
}

function WaveStrip({ bars, progress }: { bars: number[]; progress: number }) {
  const w = 4;
  const gap = 2;
  const width = bars.length * (w + gap);
  return (
    <svg className="oa-wave" viewBox={`0 0 ${width} 48`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((p, i) => {
        const h = Math.max(2, Math.min(1, p * 1.6) * 46);
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={(48 - h) / 2}
            width={w}
            height={h}
            rx={2}
            className={i / bars.length <= progress ? "is-played" : undefined}
          />
        );
      })}
    </svg>
  );
}

export function SayItOnAir({
  channelSlug,
  nowPlaying,
  variant,
  onClose,
}: {
  channelSlug: string;
  nowPlaying: OnAirNowPlaying | null;
  variant: "page" | "sheet";
  onClose?: () => void;
}) {
  const uid = useId();
  const [step, setStep] = useState<Step>("record");
  const [rec, setRec] = useState<RecState>("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [take, setTake] = useState<{ blob: Blob; seconds: number; bars: number[]; url: string } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewPos, setPreviewPos] = useState(0);

  // details
  const songOnAir = nowPlaying?.item_type === "song" && !!nowPlaying.label;
  const [kind, setKind] = useState<OnAirKind>("shoutout");
  const [firstName, setFirstName] = useState("");
  const [place, setPlace] = useState("");
  const [forName, setForName] = useState("");
  const [song, setSong] = useState<{ id: string; title: string; artist: string | null } | null>(null);
  const [songQuery, setSongQuery] = useState("");
  const [songResults, setSongResults] = useState<any[]>([]);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [consentVoice, setConsentVoice] = useState(false);
  const [consentBroadcast, setConsentBroadcast] = useState(false);
  const [consentShare, setConsentShare] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [formError, setFormError] = useState<{ message: string; field?: string } | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const meter = useRef<{ ctx: AudioContext; raf: number; read: () => number } | null>(null);
  const timers = useRef<number[]>([]);
  const startedAt = useRef(0);
  const loudest = useRef(0);
  const reactingTo = useRef<{ channel: string; label: string | null; track_id: string | null; at: number } | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const stationPaused = useRef(false);

  const pauseStation = () => {
    if (!stationPaused.current) {
      stationPaused.current = true;
      announceRecording(true);
    }
  };
  const resumeStation = () => {
    if (stationPaused.current) {
      stationPaused.current = false;
      announceRecording(false);
    }
  };

  const release = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (meter.current) {
      cancelAnimationFrame(meter.current.raf);
      void meter.current.ctx.close().catch(() => {});
      meter.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  }, []);

  // Leaving (closing the sheet, navigating away) mid-recording: stop everything and give the station back.
  useEffect(
    () => () => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
      release();
      if (stationPaused.current) announceRecording(false);
    },
    [release]
  );
  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url);
  }, [take]);

  const finish = useCallback(
    async (mime: string) => {
      release();
      setRec("converting");
      try {
        const blob = new Blob(chunks.current, { type: mime || undefined });
        const { samples, sampleRate } = await decodeToMono(blob);
        const seconds = samples.length / sampleRate;
        if (seconds < MIN_SECONDS - 0.05) {
          setRecError("That was a little short. Please record at least 3 seconds.");
          setRec("idle");
          return;
        }
        const resampled = await resampleMono(samples, sampleRate, UPLOAD_RATE);
        const capped = resampled.subarray(0, Math.min(resampled.length, Math.round((MAX_SECONDS + PRE_ROLL_MS / 1000) * UPLOAD_RATE)));
        const wav = new Blob([encodeWav(capped, UPLOAD_RATE)], { type: "audio/wav" });
        setTake({ blob: wav, seconds: capped.length / UPLOAD_RATE, bars: peaks(capped, WAVE_BARS), url: URL.createObjectURL(wav) });
        setPreviewPos(0);
        setStep("listen");
        setRec("idle");
      } catch {
        setRecError("That recording couldn't be read. Please try again.");
        setRec("idle");
      }
    },
    [release]
  );

  const stop = useCallback(() => {
    const r = recorderRef.current;
    // Given back inside the tap, so iOS lets the station start again.
    resumeStation();
    if (r && r.state !== "inactive") r.stop();
    else release();
  }, [release]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setRecError(null);
    setQuiet(false);
    setMicDenied(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecError("This browser can't record audio. Please try another browser, or send a written shout-out instead.");
      return;
    }
    pauseStation();
    setRec("asking");
    let stream: MediaStream;
    try {
      // Asked for on the tap itself: iOS only allows it inside a gesture.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      resumeStation();
      setRec("idle");
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) setMicDenied(true);
      else setRecError("We couldn't find a microphone. Check one is connected, then try again.");
      return;
    }
    streamRef.current = stream;

    // A live level meter from an AnalyserNode.
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const read = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      if (startedAt.current) loudest.current = Math.max(loudest.current, rms);
      return rms;
    };
    const m = { ctx, raf: 0, read };
    const tick = () => {
      setLevel(read());
      m.raf = requestAnimationFrame(tick);
    };
    m.raf = requestAnimationFrame(tick);
    meter.current = m;

    // 3-2-1, then record.
    setRec("countin");
    setCount(3);
    startedAt.current = 0;
    loudest.current = 0;
    for (const [n, at] of [[2, 1000], [1, 2000]] as const) timers.current.push(window.setTimeout(() => setCount(n), at));
    // The recorder starts half a second before "go": some phones drop the very
    // start of a recording, and some people start talking on "1". The Studio's
    // trim takes the extra silence off again.
    timers.current.push(
      window.setTimeout(() => {
        if (!streamRef.current) return;
        const recorder = new MediaRecorder(stream);
        chunks.current = [];
        recorder.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
        recorder.onstop = () => void finish(recorder.mimeType);
        recorderRef.current = recorder;
        recorder.start(250);
      }, 3000 - PRE_ROLL_MS)
    );
    timers.current.push(
      window.setTimeout(() => {
        if (!streamRef.current || !recorderRef.current) return;
        // "Your take on this song": what was on when they started talking.
        reactingTo.current = {
          channel: channelSlug,
          label: nowPlaying?.label ?? null,
          track_id: nowPlaying?.track_id ?? null,
          at: Date.now(),
        };
        startedAt.current = Date.now();
        setElapsed(0);
        setRec("recording");
        const clock = () => {
          const s = (Date.now() - startedAt.current) / 1000;
          setElapsed(Math.min(MAX_SECONDS, s));
          // Sampled here too, not only on animation frames (which stop while the page is hidden).
          meter.current?.read();
          // "We can't hear you" after 3 s of near-silence; gone as soon as anything is heard.
          setQuiet(s >= 3 && loudest.current < 0.008);
          if (s >= MAX_SECONDS) {
            stop();
            return;
          }
          timers.current.push(window.setTimeout(clock, 100));
        };
        clock();
      }, 3000)
    );
  };

  const cancelCountIn = () => {
    // The pre-roll may have started the recorder already: drop it without a take.
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      r.onstop = null;
      r.stop();
    }
    recorderRef.current = null;
    release();
    resumeStation();
    setRec("idle");
  };

  // ---- listen back
  const togglePreview = () => {
    const a = previewRef.current;
    if (!a) return;
    if (a.paused) {
      pauseStation();
      void a.play().catch(() => {});
    } else {
      a.pause();
    }
  };
  const reRecord = () => {
    previewRef.current?.pause();
    resumeStation();
    setTake(null);
    setStep("record");
  };

  // ---- dedication song search
  useEffect(() => {
    if (kind !== "dedication" || song || songQuery.trim().length < 2) {
      setSongResults([]);
      return;
    }
    const q = songQuery.trim();
    const t = window.setTimeout(() => {
      publicApi
        .search(q)
        .then((r) => setSongResults((r.tracks ?? []).slice(0, 6)))
        .catch(() => setSongResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [songQuery, kind, song]);

  const kinds = useMemo(() => KINDS.filter((k) => k.key !== "reaction" || songOnAir || kind === "reaction"), [songOnAir, kind]);

  const send = async () => {
    if (!take) return;
    setFormError(null);
    const bad = (message: string, field: string) => setFormError({ message, field });
    if (!firstName.trim()) return bad("Please tell us your first name.", "first_name");
    if (kind === "dedication" && !forName.trim()) return bad("Who is it for?", "for_name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return bad("Please check your email address.", "email");
    if (!consentVoice || !consentBroadcast) return bad("Please tick both boxes so we can put you on air.", "consent");
    if (!token) return bad("Please complete the check that you're a real person.", "turnstile");

    const form = new FormData();
    form.append("audio", take.blob, "voice-note.wav");
    form.append("kind", kind);
    form.append("first_name", firstName.trim());
    form.append("place", place.trim());
    if (kind === "dedication") {
      form.append("for_name", forName.trim());
      if (song) form.append("requested_track_id", song.id);
    }
    if (kind === "reaction" && reactingTo.current) form.append("reacting_to", JSON.stringify(reactingTo.current));
    form.append("note", note.trim());
    form.append("email", email.trim());
    form.append("consent_voice", consentVoice ? "1" : "0");
    form.append("consent_broadcast", consentBroadcast ? "1" : "0");
    form.append("consent_share", consentShare ? "1" : "0");
    form.append("channel", channelSlug);
    try {
      form.append("listener_tz", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    } catch {
      /* no zone: emails show Paris time */
    }
    form.append("duration_seconds", String(Math.round(take.seconds * 10) / 10));
    form.append("turnstileToken", token);
    form.append("hp_field", honeypot);

    setSending(true);
    setProgress(0);
    try {
      const r = await onAirApi.send(form, setProgress);
      setLimitReached(!!r.daily_limit && (r.sent_today ?? 0) >= r.daily_limit);
      setStep("sent");
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.code === "daily_limit") setLimitReached(true);
      setFormError({ message: e?.friendly ?? "Something went wrong sending your message. Please try again.", field: e?.field });
    } finally {
      setSending(false);
      turnstile.current?.reset();
    }
  };

  const recordAnother = () => {
    setTake(null);
    setNote("");
    setForName("");
    setSong(null);
    setSongQuery("");
    setConsentVoice(false);
    setConsentBroadcast(false);
    setConsentShare(false);
    setFormError(null);
    setStep("record");
  };

  const fieldError = (f: string) => (formError?.field === f ? formError.message : null);
  const ringFraction = rec === "recording" ? elapsed / MAX_SECONDS : 0;
  const R = 92;
  const C = 2 * Math.PI * R;

  return (
    <div className={`oa oa-${variant}`}>
      <ol className="oa-steps" aria-label="Steps">
        {(["Record", "Listen back", "Details"] as const).map((label, i) => {
          const index = { record: 0, listen: 1, details: 2, sent: 3 }[step];
          return (
            <li key={label} className={i === index ? "is-on" : i < index ? "is-done" : undefined} aria-current={i === index ? "step" : undefined}>
              <span>{i + 1}</span> {label}
            </li>
          );
        })}
      </ol>

      {step === "record" && (
        <section className="oa-panel" aria-label="Record">
          {micDenied ? (
            <div className="oa-denied" role="alert">
              <h3>We need your microphone</h3>
              <p>Your browser said no to the microphone. To allow it:</p>
              <ul>
                <li>
                  <strong>iPhone:</strong> Settings › Safari (or the We Are Radio app) › Microphone › Allow. Then come back and tap Record.
                </li>
                <li>
                  <strong>Android:</strong> tap the icon left of the address, then Permissions › Microphone › Allow.
                </li>
                <li>
                  <strong>Computer:</strong> click the microphone or lock icon in the address bar and allow the microphone.
                </li>
              </ul>
              <div className="oa-row">
                <button type="button" className="oa-btn oa-btn-red" onClick={() => void start()}>
                  Try again
                </button>
                <Link className="oa-btn" to="/contact?topic=request" onClick={onClose}>
                  Or send us a written shout-out
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className={`oa-recorder is-${rec}`}>
                <svg className="oa-ring" viewBox="0 0 200 200" aria-hidden="true">
                  <circle cx="100" cy="100" r={R} className="oa-ring-track" />
                  <circle
                    cx="100"
                    cy="100"
                    r={R}
                    className="oa-ring-fill"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - ringFraction)}
                    transform="rotate(-90 100 100)"
                  />
                </svg>
                {rec === "countin" ? (
                  <button type="button" className="oa-mic is-count" onClick={cancelCountIn} aria-label="Cancel">
                    <span className="oa-count" aria-live="assertive">
                      {count}
                    </span>
                  </button>
                ) : rec === "recording" ? (
                  <button type="button" className="oa-mic is-rec" onClick={stop} aria-label="Stop recording">
                    <span className="oa-stop" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="oa-mic"
                    onClick={() => void start()}
                    disabled={rec === "asking" || rec === "converting"}
                    aria-label="Record"
                  >
                    <MicIcon />
                  </button>
                )}
              </div>
              <div className="oa-clock" aria-live="off">
                {rec === "recording" ? (
                  <>
                    <span className="oa-rec-dot" /> {fmt(elapsed)} <span className="oa-dim">/ {fmt(MAX_SECONDS)}</span>
                  </>
                ) : rec === "countin" ? (
                  "Get ready..."
                ) : rec === "converting" ? (
                  "Getting it ready..."
                ) : rec === "asking" ? (
                  "Allow the microphone to start"
                ) : (
                  "Tap to record, up to 45 seconds"
                )}
              </div>
              {(rec === "recording" || rec === "countin") && <MicLevel level={level} />}
              {quiet && rec === "recording" && (
                <p className="oa-warn" role="status">
                  We can't hear you. Check your mic isn't muted.
                </p>
              )}
              {rec === "idle" && (
                <p className="oa-hint">
                  The station pauses while you record. Find a quiet spot and hold your phone close.
                </p>
              )}
              {recError && (
                <p className="oa-error" role="alert">
                  {recError}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {step === "listen" && take && (
        <section className="oa-panel" aria-label="Listen back">
          <h3 className="oa-h">Listen back</h3>
          <div className="oa-preview">
            <button type="button" className="oa-play" onClick={togglePreview} aria-label={previewPlaying ? "Pause" : "Play"}>
              {previewPlaying ? <span className="oa-pause-icon"><span /><span /></span> : <span className="oa-play-icon" />}
            </button>
            <WaveStrip bars={take.bars} progress={take.seconds ? previewPos / take.seconds : 0} />
            <span className="oa-len">{fmt(take.seconds)}</span>
            <audio
              ref={previewRef}
              src={take.url}
              onPlay={() => setPreviewPlaying(true)}
              onPause={() => {
                setPreviewPlaying(false);
                resumeStation();
              }}
              onEnded={() => {
                setPreviewPlaying(false);
                setPreviewPos(0);
                resumeStation();
              }}
              onTimeUpdate={(e) => setPreviewPos(e.currentTarget.currentTime)}
            />
          </div>
          <div className="oa-row">
            <button type="button" className="oa-btn" onClick={reRecord}>
              Re-record
            </button>
            <button
              type="button"
              className="oa-btn oa-btn-red"
              onClick={() => {
                previewRef.current?.pause();
                setStep("details");
              }}
            >
              Use this one
            </button>
          </div>
        </section>
      )}

      {step === "details" && take && (
        <section className="oa-panel" aria-label="Details">
          <div className="oa-chips" role="radiogroup" aria-label="What is it?">
            {kinds.map((k) => (
              <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={`oa-chip${kind === k.key ? " is-on" : ""}`} onClick={() => setKind(k.key)}>
                {k.label}
              </button>
            ))}
          </div>
          {kind === "reaction" && reactingTo.current?.label && <p className="oa-hint is-left">About: {reactingTo.current.label}</p>}

          <div className="oa-grid">
            <label className="oa-field">
              <span className="oa-label">First name</span>
              <input className="oa-input" value={firstName} maxLength={40} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} aria-invalid={!!fieldError("first_name")} aria-describedby={`${uid}-fn`} />
              <small id={`${uid}-fn`}>This is the name we'll say on air.</small>
              {fieldError("first_name") && <span className="oa-error">{fieldError("first_name")}</span>}
            </label>
            <label className="oa-field">
              <span className="oa-label">Where are you listening from?</span>
              <input className="oa-input" value={place} maxLength={60} placeholder="Town or country" onChange={(e) => setPlace(e.target.value)} aria-invalid={!!fieldError("place")} />
              <small>Optional.</small>
              {fieldError("place") && <span className="oa-error">{fieldError("place")}</span>}
            </label>

            {kind === "dedication" && (
              <>
                <label className="oa-field">
                  <span className="oa-label">Dedicated to</span>
                  <input className="oa-input" value={forName} maxLength={60} onChange={(e) => setForName(e.target.value)} aria-invalid={!!fieldError("for_name")} />
                  {fieldError("for_name") && <span className="oa-error">{fieldError("for_name")}</span>}
                </label>
                <div className="oa-field">
                  <span className="oa-label" id={`${uid}-song`}>
                    Pick a song for them
                  </span>
                  {song ? (
                    <div className="oa-song-picked">
                      <span>
                        {song.title}
                        {song.artist ? <span className="oa-dim"> · {song.artist}</span> : null}
                      </span>
                      <button type="button" className="oa-link" onClick={() => setSong(null)}>
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <input className="oa-input" value={songQuery} placeholder="Search our music" aria-labelledby={`${uid}-song`} onChange={(e) => setSongQuery(e.target.value)} />
                      {songResults.length > 0 && (
                        <ul className="oa-song-list">
                          {songResults.map((t) => (
                            <li key={t.id}>
                              <button type="button" onClick={() => setSong({ id: t.id, title: t.title, artist: t.artist ?? null })}>
                                {t.title}
                                {t.artist ? <span className="oa-dim"> · {t.artist}</span> : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  <small>Optional. Kizzi will try to play it after your message.</small>
                  {fieldError("requested_track_id") && <span className="oa-error">{fieldError("requested_track_id")}</span>}
                </div>
              </>
            )}

            <label className="oa-field is-full">
              <span className="oa-label">A note for Kizzi</span>
              <textarea className="oa-input" rows={3} value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} aria-invalid={!!fieldError("note")} />
              <small>
                Optional. Only Kizzi reads this. It's never read out. <span className="oa-dim">{note.length} / 280</span>
              </small>
            </label>
            <label className="oa-field is-full">
              <span className="oa-label">Email</span>
              <input className="oa-input" type="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldError("email")} />
              <small>So we can tell you when you're on air. We never publish it.</small>
              {fieldError("email") && <span className="oa-error">{fieldError("email")}</span>}
            </label>
          </div>

          <div className={`oa-consent${fieldError("consent") ? " is-invalid" : ""}`}>
            <label>
              <input type="checkbox" checked={consentVoice} onChange={(e) => setConsentVoice(e.target.checked)} />
              <span>This is my voice, and I'm 16 or over.</span>
            </label>
            <label>
              <input type="checkbox" checked={consentBroadcast} onChange={(e) => setConsentBroadcast(e.target.checked)} />
              <span>
                We Are Radio can broadcast my recording with my first name and where I'm listening from, and trim it or adjust the sound.
              </span>
            </label>
            <label>
              <input type="checkbox" checked={consentShare} onChange={(e) => setConsentShare(e.target.checked)} />
              <span>
                You can also share the clip on We Are Radio's website and social media. <span className="oa-dim">(Optional)</span>
              </span>
            </label>
          </div>

          {/* A real person never sees this; a form-filling bot does. */}
          <input className="oa-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="hp_field" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />

          <div className="oa-turnstile">
            <Turnstile ref={turnstile} action="onair" onToken={setToken} />
          </div>

          {formError && (
            <p className="oa-error oa-form-error" role="alert">
              {formError.message}
            </p>
          )}

          <div className="oa-row">
            <button type="button" className="oa-btn" onClick={() => setStep("listen")} disabled={sending}>
              Back
            </button>
            <button type="button" className="oa-btn oa-btn-red" onClick={() => void send()} disabled={sending || limitReached}>
              {sending ? `Sending... ${Math.round(progress * 100)}%` : "Send to Kizzi"}
            </button>
          </div>
        </section>
      )}

      {step === "sent" && (
        <section className="oa-panel oa-sent" aria-live="polite">
          <div className="oa-sent-badge" aria-hidden="true">
            <MicIcon />
          </div>
          <h3 className="oa-h">It's with Kizzi.</h3>
          <p>He listens to every message himself. If yours is picked, we'll email you to say when it's going out, so you can tune in.</p>
          <div className="oa-row">
            {variant === "sheet" ? (
              <button type="button" className="oa-btn oa-btn-red" onClick={onClose}>
                Keep listening
              </button>
            ) : (
              <Link className="oa-btn oa-btn-red" to={`/channel/${channelSlug}`}>
                Keep listening
              </Link>
            )}
            <button type="button" className="oa-btn" onClick={recordAnother} disabled={limitReached}>
              {limitReached ? "You've sent 3 today" : "Record another"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function MicIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}
