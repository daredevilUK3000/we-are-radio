import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../../api/client";
import { onAirStudioApi, type StudioChannel, type StudioVoice } from "../../api/onAir";
import { decodeToMono, encodeWav, peaks } from "../../shared/wav";
import { assemble, autoTrim, processClip, type Clip, type LevelReport } from "../lib/voicePrep";
import "./onair-studio.css";

/**
 * /studio/on-air, "Listener voices" (handoff_say_it_on_air.md §4.4).
 *
 * The gate, in the screen as on the server: Prepare and Approve stay off
 * until Kizzi has played the raw message through to the end (seeking past
 * what he's heard doesn't count), and Approve needs the prepared audio.
 */

type Tab = "pending" | "scheduled" | "aired" | "rejected";
const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "scheduled", label: "Approved and scheduled" },
  { key: "aired", label: "Aired" },
  { key: "rejected", label: "Rejected" },
];

const KIND: Record<string, { label: string; icon: string }> = {
  shoutout: { label: "Shout-out", icon: "📣" },
  dedication: { label: "Dedication", icon: "💌" },
  reaction: { label: "Their take on a song", icon: "🎧" },
  question: { label: "Question for Kizzi", icon: "❓" },
};

const PARIS = "Europe/Paris";
const fmtLen = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const parisTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A Paris wall-clock "YYYY-MM-DDTHH:MM" to an instant, and back. */
function parisOffset(ms: number) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(ms);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}
function parisLocalToMs(local: string): number {
  const guess = Date.parse(`${local}:00Z`);
  const first = guess - parisOffset(guess);
  return guess - parisOffset(first);
}
function msToParisLocal(ms: number): string {
  const d = new Date(ms + parisOffset(ms));
  return d.toISOString().slice(0, 16);
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export function OnAirInbox() {
  const [tab, setTab] = useState<Tab>("pending");
  const [list, setList] = useState<StudioVoice[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [channels, setChannels] = useState<StudioChannel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the last action did ("Placed.", "Held..."): shown above the list, since the detail panel moves on to the next message.
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  useEffect(() => {
    if (!flash || flash.bad) return;
    const t = window.setTimeout(() => setFlash(null), 12_000);
    return () => window.clearTimeout(t);
  }, [flash]);

  const load = useCallback(
    async (keep?: string | null) => {
      try {
        const r = await onAirStudioApi.messages(tab);
        setList(r.messages);
        setCounts(r.counts);
        setChannels(r.channels);
        setError(null);
        setSelected((cur) => {
          const want = keep === undefined ? cur : keep;
          return want && r.messages.some((m) => m.id === want) ? want : (r.messages[0]?.id ?? null);
        });
      } catch (e: any) {
        setError(e?.friendly ?? "Couldn't load the messages.");
      }
    },
    [tab]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const current = list.find((m) => m.id === selected) ?? null;

  return (
    <div className="oas">
      <div className="oas-head">
        <h1>Listener voices</h1>
        <p className="oas-sub">Voice notes from "Send a shout out". Nothing reaches air until you've listened to all of it and approved it.</p>
      </div>
      <div className="oas-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`oas-tab${tab === t.key ? " is-on" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {counts[t.key] ? <span className="oas-count">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>
      {error && <p className="tc-error">{error}</p>}
      {flash && (
        <p className={`oas-banner${flash.bad ? " is-bad" : ""}`} role="status">
          {flash.text}
          <button className="oas-banner-x" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      )}

      <div className="oas-layout">
        <ul className="oas-list card">
          {list.length === 0 && <li className="oas-empty">Nothing here.</li>}
          {list.map((m) => (
            <li key={m.id}>
              <button className={`oas-row${m.id === selected ? " is-on" : ""}`} onClick={() => setSelected(m.id)}>
                <span className="oas-kind" title={KIND[m.kind]?.label}>
                  {KIND[m.kind]?.icon}
                </span>
                <span className="oas-row-main">
                  <strong>
                    {m.first_name || "(withdrawn)"}
                    {m.place ? <span className="oas-dim"> · {m.place}</span> : null}
                  </strong>
                  <span className="oas-dim">
                    {fmtLen(m.raw_seconds)} · {m.air_channel_name ?? m.channel_name ?? "No channel"} · {ago(m.created_at)}
                  </span>
                  {m.flag && <span className="oas-flag">{m.flag}</span>}
                </span>
                {!m.listened_full && m.status === "pending" && <span className="oas-unheard" title="Not heard yet" />}
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <Detail key={current.id} m={current} channels={channels} onChanged={(keep) => void load(keep)} onFlash={setFlash} />
        ) : (
          <div className="card oas-detail oas-empty">Pick a message.</div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- detail

function Detail({
  m,
  channels,
  onChanged,
  onFlash,
}: {
  m: StudioVoice;
  channels: StudioChannel[];
  onChanged: (keep?: string | null) => void;
  onFlash: (f: { text: string; bad?: boolean } | null) => void;
}) {
  const [listened, setListened] = useState(!!m.listened_full);
  const [clip, setClip] = useState<Clip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const editable = ["pending", "approved", "scheduled"].includes(m.status);

  // The raw recording, decoded once for the waveform and for preparing.
  useEffect(() => {
    if (!m.has_raw) return;
    let cancelled = false;
    fetch(onAirStudioApi.rawUrl(m.id), { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => decodeToMono(b))
      .then((d) => !cancelled && setClip({ samples: d.samples, rate: d.sampleRate }))
      .catch(() => !cancelled && setLoadError("Couldn't load the recording."));
    return () => {
      cancelled = true;
    };
  }, [m.id, m.has_raw]);

  const run = async (fn: () => Promise<unknown>, done?: string, keep: string | null = m.id) => {
    setBusy(true);
    setNote(null);
    try {
      const r: any = await fn();
      const text = `${m.first_name || "Message"}: ${r?.message ?? done ?? "Done."}`;
      // Moving on to another message: say what happened above the list. Staying: say it here.
      if (keep === m.id) setNote({ text: r?.message ?? done ?? "Done." });
      else onFlash({ text });
      onChanged(keep);
    } catch (e: any) {
      setNote({ text: e?.friendly ?? "That didn't work.", bad: true });
    } finally {
      setBusy(false);
    }
  };

  const k = KIND[m.kind];
  return (
    <div className="card oas-detail">
      <div className="oas-detail-head">
        <div>
          <div className="oas-eyebrow">
            {k?.icon} {k?.label}
            {m.status !== "pending" && <span className={`oas-status is-${m.status}`}>{m.status}</span>}
          </div>
          <h2>
            {m.first_name || "(withdrawn)"}
            {m.place ? <span className="oas-dim"> in {m.place}</span> : null}
          </h2>
        </div>
        <div className="oas-dim oas-received">Received {ago(m.created_at)}</div>
      </div>

      {m.flag && <p className="oas-flag oas-flag-big">{m.flag}</p>}

      {m.has_raw ? (
        <RawPlayer m={m} clip={clip} listened={listened} onListened={() => setListened(true)} />
      ) : (
        <p className="oas-dim">The raw recording has been deleted.</p>
      )}
      {loadError && <p className="tc-error">{loadError}</p>}

      <dl className="oas-facts">
        {m.kind === "dedication" && (
          <>
            <dt>For</dt>
            <dd>{m.for_name || "-"}</dd>
            <dt>Their song</dt>
            <dd>{m.requested_track_title ? `${m.requested_track_title}${m.requested_track_artist ? ` · ${m.requested_track_artist}` : ""}` : "None picked"}</dd>
          </>
        )}
        {m.reacting_to && (
          <>
            <dt>Reacting to</dt>
            <dd>
              {m.reacting_to.label ?? "-"} <span className="oas-dim">({parisTime(m.reacting_to.at)})</span>
            </dd>
          </>
        )}
        <dt>Listening on</dt>
        <dd>{m.channel_name ?? "-"}</dd>
        <dt>Note to you</dt>
        <dd className="oas-note">{m.note || <span className="oas-dim">None</span>}</dd>
        <dt>Sender</dt>
        <dd>
          {ordinal(m.sender_nth)} message · {m.sender_aired} aired
          {m.sender_rejected ? ` · ${m.sender_rejected} not used` : ""}
          {m.blocked ? <strong className="oas-blocked"> · Blocked</strong> : null}
        </dd>
        <dt>Consents</dt>
        <dd>
          Own voice, 16+ ✓ · Broadcast ✓ · Share on web and socials {m.consent_share ? "✓" : <span className="oas-dim">no</span>}
        </dd>
        {m.status === "placed" && m.expected_at_ms && (
          <>
            <dt>Goes out</dt>
            <dd>
              {m.air_channel_name}, around {parisTime(m.expected_at_ms)}
            </dd>
          </>
        )}
        {m.status === "scheduled" && m.air_after_ms && (
          <>
            <dt>Due</dt>
            <dd>
              {m.air_channel_name}, {m.air_when === "next" ? "next break" : `first break after ${parisTime(m.air_after_ms)}`} (waiting to be placed)
            </dd>
          </>
        )}
        {m.status === "aired" && m.aired_at_ms && (
          <>
            <dt>Aired</dt>
            <dd>
              {m.air_channel_name}, {parisTime(m.aired_at_ms)}
            </dd>
          </>
        )}
        {m.song_note && (
          <>
            <dt>Their song</dt>
            <dd>{m.song_note}</dd>
          </>
        )}
        {m.reject_reason && (
          <>
            <dt>Reason</dt>
            <dd>{m.reject_reason === "blocked" ? "Sender blocked" : m.reject_reason}</dd>
          </>
        )}
      </dl>

      {editable && <PreparePanel m={m} clip={clip} listened={listened} onSaved={() => onChanged(m.id)} />}

      {/* Always shown, so the next step is visible; greyed out until it can be used. */}
      {editable && (
        <AirPanel
          m={m}
          channels={channels}
          busy={busy}
          run={run}
          locked={!listened ? "Listen to the end first." : !m.audio_asset_id ? "Prepare the audio first: Trim and level, then Use this for air." : null}
        />
      )}

      {(m.status === "scheduled" || m.status === "placed") && (
        <div className="oas-actions">
          <button className="btn" disabled={busy} onClick={() => void run(() => onAirStudioApi.unschedule(m.id), "Taken off the schedule. It's waiting in Approved.")}>
            Unschedule
          </button>
        </div>
      )}

      {m.prepared_url && !editable && (
        <div className="oas-prepared">
          <span className="oas-dim">Aired audio</span>
          <audio controls src={mediaUrl(m.prepared_url)} preload="none" />
        </div>
      )}

      {["pending", "approved", "scheduled"].includes(m.status) && <RejectPanel m={m} busy={busy} run={run} />}
      {m.status === "rejected" && m.blocked ? (
        <div className="oas-actions">
          <button className="btn" disabled={busy} onClick={() => void run(() => onAirStudioApi.unblock(m.id), "Unblocked.")}>
            Unblock sender
          </button>
        </div>
      ) : null}

      {note && <p className={note.bad ? "tc-error" : "oas-ok"}>{note.text}</p>}
    </div>
  );
}

// -------------------------------------------------------- raw player

/** The raw message. Counts as heard only when playback reaches the end without skipping ahead. */
function RawPlayer({ m, clip, listened, onListened }: { m: StudioVoice; clip: Clip | null; listened: boolean; onListened: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const heard = useRef(0);
  const last = useRef(0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const bars = useMemo(() => (clip ? peaks(clip.samples, 120) : []), [clip]);
  const total = clip ? clip.samples.length / clip.rate : m.raw_seconds;

  const onTime = () => {
    const a = audio.current;
    if (!a) return;
    // Normal playback moves on by well under a second per update; a jump ahead isn't "heard".
    if (a.currentTime - last.current < 1.2 && a.currentTime > heard.current) heard.current = a.currentTime;
    last.current = a.currentTime;
    setPos(a.currentTime);
  };
  const onEnded = () => {
    setPlaying(false);
    const a = audio.current;
    const dur = a && Number.isFinite(a.duration) ? a.duration : total;
    if (!listened && heard.current >= dur - 1) {
      void onAirStudioApi.listened(m.id).then(onListened).catch(() => {});
    }
  };

  return (
    <div className="oas-raw">
      <button className="oas-play" onClick={() => (audio.current?.paused ? void audio.current.play() : audio.current?.pause())} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <svg className="oas-wave" viewBox={`0 0 ${bars.length * 4 || 4} 60`} preserveAspectRatio="none" aria-hidden="true">
        {bars.map((p, i) => {
          const h = Math.max(2, Math.min(1, p) * 58);
          return <rect key={i} x={i * 4} y={(60 - h) / 2} width={3} height={h} className={i / bars.length <= pos / total ? "is-played" : undefined} />;
        })}
      </svg>
      <span className="oas-dim oas-time">
        {fmtLen(pos)} / {fmtLen(total)}
      </span>
      <span className={`oas-heard${listened ? " is-done" : ""}`}>{listened ? "Heard in full ✓" : "Not heard to the end yet"}</span>
      <audio
        ref={audio}
        src={onAirStudioApi.rawUrl(m.id)}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTime}
        onSeeking={() => {
          last.current = audio.current?.currentTime ?? 0;
        }}
        onEnded={onEnded}
      />
    </div>
  );
}

// -------------------------------------------------------- preparing

function PreparePanel({ m, clip, listened, onSaved }: { m: StudioVoice; clip: Clip | null; listened: boolean; onSaved: () => void }) {
  const total = clip ? clip.samples.length / clip.rate : m.raw_seconds;
  const auto = useMemo(() => (clip ? autoTrim(clip) : { start: 0, end: total }), [clip, total]);
  const [trim, setTrim] = useState(auto);
  useEffect(() => setTrim(auto), [auto]);
  const [intro, setIntro] = useState<Clip | null>(null);
  const [outro, setOutro] = useState<Clip | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; seconds: number; report: LevelReport } | null>(null);
  const [ab, setAb] = useState<"before" | "after">("after");
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abRef = useRef<HTMLAudioElement>(null);
  const beforeUrl = useMemo(() => onAirStudioApi.rawUrl(m.id), [m.id]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const build = async () => {
    if (!clip) return;
    setWorking(true);
    setErr(null);
    setSaved(null);
    try {
      const voice = await processClip(clip, trim);
      const i = intro ? (await processClip(intro, autoTrim(intro))).samples : null;
      const o = outro ? (await processClip(outro, autoTrim(outro))).samples : null;
      const out = assemble({ intro: i, voice: voice.samples, outro: o });
      setResult({ url: URL.createObjectURL(out.wav), blob: out.wav, seconds: out.seconds, report: voice.report });
      setAb("after");
    } catch {
      setErr("Couldn't process the audio in this browser.");
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setWorking(true);
    setErr(null);
    try {
      const r = await onAirStudioApi.prepare(m.id, result.blob, !!(intro || outro));
      setSaved(`Saved: ${fmtLen(r.seconds)} ready for air.`);
      onSaved();
    } catch (e: any) {
      setErr(e?.friendly ?? "Couldn't save it.");
    } finally {
      setWorking(false);
    }
  };

  const switchAb = (which: "before" | "after") => {
    const a = abRef.current;
    const wasPlaying = a && !a.paused;
    setAb(which);
    // The new source starts again from the top: "before" is the whole raw take, "after" is trimmed, so times don't line up.
    requestAnimationFrame(() => wasPlaying && void abRef.current?.play().catch(() => {}));
  };

  return (
    <section className="oas-panel">
      <h3>1. Prepare</h3>
      {m.prepared_url && (
        <p className="oas-dim">
          Prepared already ({fmtLen(m.prepared_seconds ?? 0)}{m.with_intro ? ", with your intro/outro" : ""}).{" "}
          <audio className="oas-inline-audio" controls src={mediaUrl(m.prepared_url)} preload="none" />
        </p>
      )}
      {!listened ? (
        <p className="oas-hint">Listen to the end first.</p>
      ) : !clip ? (
        <p className="oas-dim">Loading the recording...</p>
      ) : (
        <>
          <div className="oas-trim">
            <label>
              Start <strong>{trim.start.toFixed(2)} s</strong>
              <input type="range" min={0} max={total} step={0.01} value={trim.start} onChange={(e) => setTrim((t) => ({ ...t, start: Math.min(Number(e.target.value), t.end - 0.5) }))} />
            </label>
            <label>
              End <strong>{trim.end.toFixed(2)} s</strong>
              <input type="range" min={0} max={total} step={0.01} value={trim.end} onChange={(e) => setTrim((t) => ({ ...t, end: Math.max(Number(e.target.value), t.start + 0.5) }))} />
            </label>
            <button className="btn" onClick={() => setTrim(auto)}>
              Auto-trim silence
            </button>
          </div>
          <div className="oas-kizzi">
            <MiniRecorder label="intro" clip={intro} onClip={setIntro} />
            <MiniRecorder label="outro" clip={outro} onClip={setOutro} />
          </div>
          <div className="oas-actions">
            <button className="btn" onClick={() => void build()} disabled={working}>
              {working ? "Working..." : result ? "Process again" : "Trim and level"}
            </button>
          </div>
          {result && (
            <div className="oas-result">
              <div className="oas-ab" role="group" aria-label="Before and after">
                <button className={`oas-ab-btn${ab === "before" ? " is-on" : ""}`} onClick={() => switchAb("before")}>
                  Before
                </button>
                <button className={`oas-ab-btn${ab === "after" ? " is-on" : ""}`} onClick={() => switchAb("after")}>
                  After
                </button>
                <audio ref={abRef} controls src={ab === "after" ? result.url : beforeUrl} />
              </div>
              <p className="oas-dim">
                Final length <strong>{fmtLen(result.seconds)}</strong> · listener level {result.report.rmsBeforeDb.toFixed(1)} → {result.report.rmsAfterDb.toFixed(1)} dBFS (
                {result.report.gainDb >= 0 ? "+" : ""}
                {result.report.gainDb.toFixed(1)} dB), peak {result.report.peakAfterDb.toFixed(1)} dBFS
              </p>
              <div className="oas-actions">
                <button className="btn primary" onClick={() => void save()} disabled={working}>
                  Use this for air
                </button>
              </div>
            </div>
          )}
          {saved && <p className="oas-ok">{saved}</p>}
          {err && <p className="tc-error">{err}</p>}
        </>
      )}
    </section>
  );
}

/** Kizzi's own intro or outro, up to 30 s. */
function MiniRecorder({ label, clip, onClip }: { label: "intro" | "outro"; clip: Clip | null; onClip: (c: Clip | null) => void }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const url = useMemo(() => {
    if (!clip) return null;
    // A quick listen-back of the raw take.
    return URL.createObjectURL(new Blob([encodeWav(clip.samples, clip.rate)], { type: "audio/wav" }));
  }, [clip]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        window.clearInterval(timer.current);
        stream.getTracks().forEach((t) => t.stop());
        setState("busy");
        try {
          const d = await decodeToMono(new Blob(chunks, { type: r.mimeType }));
          onClip({ samples: d.samples, rate: d.sampleRate });
        } catch {
          setErr("Couldn't read that recording.");
        }
        setState("idle");
      };
      rec.current = r;
      r.start();
      const t0 = Date.now();
      setSecs(0);
      setState("rec");
      timer.current = window.setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setSecs(s);
        if (s >= 30) r.stop();
      }, 200);
    } catch {
      setErr("The microphone isn't available.");
    }
  };

  return (
    <div className="oas-mini">
      <strong>Your {label}</strong>
      {state === "rec" ? (
        <button className="btn primary" onClick={() => rec.current?.stop()}>
          ■ Stop ({Math.floor(secs)} s / 30)
        </button>
      ) : (
        <button className="btn" onClick={() => void start()} disabled={state === "busy"}>
          ● Record {label}
        </button>
      )}
      {clip && url && (
        <>
          <audio controls src={url} />
          <button className="btn" onClick={() => onClip(null)}>
            Remove
          </button>
        </>
      )}
      {err && <span className="tc-error">{err}</span>}
    </div>
  );
}

// ------------------------------------------------------- putting on air

function AirPanel({
  m,
  channels,
  busy,
  run,
  locked,
}: {
  m: StudioVoice;
  channels: StudioChannel[];
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string, keep?: string | null) => Promise<void>;
  /** Why it can't be used yet, or null when it can. */
  locked: string | null;
}) {
  const [channelId, setChannelId] = useState(m.air_channel_id ?? m.channel_id ?? channels[0]?.id ?? "");
  const ch = channels.find((c) => c.id === channelId);
  const enabled = !!ch?.scheduler;
  const [when, setWhen] = useState<"next" | "at">(enabled ? "next" : "at");
  useEffect(() => {
    if (!enabled) setWhen("at");
  }, [enabled]);
  const [at, setAt] = useState(() => msToParisLocal(m.air_after_ms && m.air_after_ms > Date.now() ? m.air_after_ms : Date.now() + 60 * 60_000));
  const [song, setSong] = useState(m.play_song_after ? true : !!m.requested_track_id);

  const approve = () =>
    run(
      () =>
        onAirStudioApi.approve(m.id, {
          channel_id: channelId,
          when,
          air_after_ms: when === "at" ? parisLocalToMs(at) : undefined,
          play_song_after: song,
        }),
      undefined,
      null
    );

  return (
    <section className={`oas-panel${locked ? " is-locked" : ""}`} aria-disabled={!!locked}>
      <h3>2. Put it on air</h3>
      {locked && <p className="oas-hint">{locked}</p>}
      <fieldset className="oas-fieldset" disabled={!!locked}>
      <div className="oas-air">
        <label>
          Channel
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.scheduler ? "" : " (Scheduler not on air)"}
              </option>
            ))}
          </select>
        </label>
        <div className="oas-when" role="radiogroup" aria-label="When">
          {enabled ? (
            <label>
              <input type="radio" checked={when === "next"} onChange={() => setWhen("next")} /> Next, after this song
            </label>
          ) : (
            <p className="oas-hint">The Scheduler isn't on air for {ch?.name ?? "this channel"} yet. You can hold this or pick another channel.</p>
          )}
          <label>
            <input type="radio" checked={when === "at"} onChange={() => setWhen("at")} /> Around…
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={when !== "at"} />
            <span className="oas-dim">Paris time, up to 7 days ahead. It airs at the first break after that time.</span>
          </label>
        </div>
        {m.kind === "dedication" && m.requested_track_id && (
          <label className="oas-check">
            <input type="checkbox" checked={song} onChange={(e) => setSong(e.target.checked)} /> Play their song straight after ({m.requested_track_title})
          </label>
        )}
      </div>
      <div className="oas-actions">
        <button className="btn primary" disabled={busy || !channelId || (when === "next" && !enabled)} onClick={() => void approve()}>
          Approve and put on air
        </button>
        <button className="btn" disabled={busy} onClick={() => void run(() => onAirStudioApi.hold(m.id, { channel_id: channelId, play_song_after: song }), "Held. It's waiting in Approved (and in Master Control's Voices drawer).", null)}>
          Hold for later
        </button>
      </div>
      </fieldset>
    </section>
  );
}

function RejectPanel({ m, busy, run }: { m: StudioVoice; busy: boolean; run: (fn: () => Promise<unknown>, done?: string, keep?: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [tell, setTell] = useState(true);
  const [confirmBlock, setConfirmBlock] = useState(false);
  return (
    <section className="oas-panel oas-panel-quiet">
      {open ? (
        <div className="oas-reject">
          <label>
            Reason (optional, included in the email)
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. It was too hard to hear" />
          </label>
          <label className="oas-check">
            <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Tell them
          </label>
          <div className="oas-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy} onClick={() => void run(() => onAirStudioApi.reject(m.id, { reason, notify: tell }), "Marked as not this time.", null)}>
              Not this time
            </button>
          </div>
        </div>
      ) : (
        <div className="oas-actions">
          <button className="btn" onClick={() => setOpen(true)}>
            Not this time
          </button>
          {confirmBlock ? (
            <>
              <span className="oas-dim">Block this sender? Their future messages are silently set aside.</span>
              <button className="btn" onClick={() => setConfirmBlock(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void run(() => onAirStudioApi.block(m.id), "Sender blocked.", null)}>
                Block
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirmBlock(true)}>
              Block sender
            </button>
          )}
        </div>
      )}
    </section>
  );
}
