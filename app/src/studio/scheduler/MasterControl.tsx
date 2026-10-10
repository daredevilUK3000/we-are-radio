import { useCallback, useEffect, useRef, useState } from "react";
import { onAirStudioApi } from "../../api/onAir";
import { Link } from "react-router-dom";
import { ApiError, mediaUrl } from "../../api/client";
import { recordingToWav } from "../lib/wav";
import { friendly, schedApi, type ActionBody, type HealthCheck, type OverviewChannel, type SchedItem, type Timeline } from "./api";
import { Bars, clock, dayHm, hm, hms, HEALTH_LABEL, longDate, Modal, SchedulerNav, Toast, useNow, type ToastState } from "./common";
import { LibraryPicker } from "./LibraryPicker";
import { FallbackEditor } from "./FallbackEditor";
import { AiringHistory, VersionHistory } from "./History";
import "./scheduler.css";
import "../pages/onair-studio.css";

/**
 * Studio -> Scheduler -> Master Control (/studio/scheduler): every channel at
 * a glance, the focused channel's now/next, and the live controls. Every
 * control publishes a new version of the log (with Undo for 60 s).
 */

const STATE_LABEL: Record<OverviewChannel["state"], string> = {
  scheduler: "SCHEDULER · LIVE",
  shadow: "SHADOW",
  fallback: "FALLBACK",
  not_live: "NOT LIVE",
};

export function MasterControl() {
  const now = useNow(1000);
  const [overview, setOverview] = useState<OverviewChannel[] | null>(null);
  const [focus, setFocus] = useState<string | null>(() => new URLSearchParams(window.location.search).get("channel"));
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [health, setHealth] = useState<HealthCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    | null
    | { kind: "picker"; mode: "play_now" | "insert_next" | "replace" | "fallback" | "jingle"; airingId?: string }
    | { kind: "preview" }
    | { kind: "versions" }
    | { kind: "airing"; airingId: string; label: string | null }
    | { kind: "fallback" }
    | { kind: "enable"; on: boolean }
  >(null);

  const loadOverview = useCallback(() => {
    schedApi
      .overview()
      .then((r) => {
        setOverview(r.channels);
        setError(null);
        setFocus((f) => f ?? r.channels.find((c) => c.status === "live")?.slug ?? r.channels[0]?.slug ?? null);
      })
      .catch((err) => setError(friendly(err, "Couldn't load the channels.")));
  }, []);
  const loadTimeline = useCallback(() => {
    if (!focus) return;
    schedApi
      .timeline(focus)
      .then(setTimeline)
      .catch(() => {});
  }, [focus]);
  const loadHealth = useCallback((fresh = false) => {
    schedApi
      .health(fresh)
      .then((r) => setHealth(r.checks))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadOverview();
    loadHealth();
    const a = window.setInterval(loadOverview, 10_000);
    const b = window.setInterval(() => loadHealth(), 60_000);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, [loadOverview, loadHealth]);
  useEffect(() => {
    setTimeline(null);
    loadTimeline();
    const id = window.setInterval(loadTimeline, 5_000);
    if (focus) {
      const url = new URL(window.location.href);
      url.searchParams.set("channel", focus);
      window.history.replaceState(window.history.state, "", url);
    }
    return () => window.clearInterval(id);
  }, [focus, loadTimeline]);
  // The on-air item ends: move on promptly.
  useEffect(() => {
    if (timeline?.on_air && now > timeline.on_air.ends_at_ms + 800) loadTimeline();
  }, [now, timeline, loadTimeline]);

  const channel = overview?.find((c) => c.slug === focus) ?? null;
  // Listener voice notes approved for this channel and waiting to be played (the Voices drawer).
  const [voices, setVoices] = useState<any[]>([]);
  const loadVoices = useCallback(() => {
    if (!channel?.id) return setVoices([]);
    onAirStudioApi
      .voices(channel.id)
      .then((r) => setVoices(r.voices))
      .catch(() => setVoices([]));
  }, [channel?.id]);
  useEffect(() => {
    loadVoices();
    const id = window.setInterval(loadVoices, 30_000);
    return () => window.clearInterval(id);
  }, [loadVoices]);
  const counts = {
    red: health?.filter((h) => h.level === "red").length ?? 0,
    amber: health?.filter((h) => h.level === "amber").length ?? 0,
  };

  const afterChange = (res: { version: number; previous: number; message: string }) => {
    setToast({ message: res.message, undo: { number: res.previous, expected: res.version, until: Date.now() + 60_000 } });
    loadTimeline();
    loadOverview();
  };
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "schedule_changed") {
      setToast({ message: "The schedule just changed. Here's the latest.", tone: "info" });
      loadTimeline();
      return;
    }
    setToast({ message: friendly(err), tone: "error" });
  };

  const act = async (body: Omit<ActionBody, "expected_version">) => {
    if (!timeline || !focus) return;
    setBusy(true);
    try {
      afterChange(await schedApi.action(focus, { ...body, expected_version: timeline.live_version } as ActionBody));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!toast?.undo || !focus) return;
    const u = toast.undo;
    setToast(null);
    try {
      const res = await schedApi.rollback(focus, u.number, u.expected);
      setToast({ message: `Undone. Back to v${u.number}'s plan, as v${res.version}.` });
      loadTimeline();
      loadOverview();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="sch">
      <SchedulerNav />
      <header className="sch-head">
        <div>
          <h1 className="sch-h1">Master Control</h1>
          <p className="sch-dim">
            {longDate(now)} · <span className="sch-clock">{hms(now)}</span> Paris
          </p>
        </div>
        <div className="sch-head-right">
          {counts.red || counts.amber ? (
            <button
              type="button"
              className={`sch-pill is-${counts.red ? "red" : "amber"} is-link`}
              title="Show them in Schedule health"
              onClick={() => {
                const card = document.getElementById("sch-health");
                if (!card) return;
                card.scrollIntoView({ behavior: "smooth", block: "start" });
                card.focus({ preventScroll: true });
              }}
            >
              <i aria-hidden="true" />
              {counts.red ? `Action needed: ${counts.red}` : `Attention: ${counts.amber} items`}
            </button>
          ) : (
            <span className="sch-pill is-green">
              <i aria-hidden="true" />
              All clear
            </span>
          )}
          <button type="button" className="sch-btn" onClick={() => setModal({ kind: "preview" })} disabled={!timeline?.up_next.length}>
            Preview next 2 hours
          </button>
        </div>
      </header>

      {error && (
        <p className="sch-error" role="alert">
          {error}
        </p>
      )}

      <ChannelStrip channels={overview} focus={focus} onFocus={setFocus} now={now} />

      {channel && (
        <div className="sch-layout">
          <div className="sch-main">
            <div className="sch-channel-head">
              <h2 className="sch-h2">
                {channel.emoji ? <span aria-hidden="true">{channel.emoji} </span> : null}
                {channel.name}
              </h2>
              <button type="button" className="sch-version" onClick={() => setModal({ kind: "versions" })} disabled={!channel.live_version}>
                {channel.enabled ? "LIVE" : "SHADOW"} · v{timeline?.channel.slug === channel.slug ? timeline.live_version : channel.live_version}
              </button>
              {voices.length > 0 && (
                <button
                  type="button"
                  className="sch-version sch-voices-count"
                  onClick={() => document.getElementById("sch-voices")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  title="Listener voice notes waiting to be played"
                >
                  🎙 {voices.length} {voices.length === 1 ? "voice" : "voices"}
                </button>
              )}
              <ChannelMenu
                enabled={channel.enabled}
                onFallback={() => setModal({ kind: "fallback" })}
                onDisable={() => setModal({ kind: "enable", on: false })}
              />
            </div>

            <GridLine timeline={timeline} channel={channel} />
            <NowPlayingCard item={timeline?.on_air ?? null} channel={channel} now={now} onHistory={(a, l) => setModal({ kind: "airing", airingId: a, label: l })} />
            <UpNext
              timeline={timeline}
              now={now}
              controls={channel.enabled}
              onReplace={(airingId) => setModal({ kind: "picker", mode: "replace", airingId })}
              onHistory={(a, l) => setModal({ kind: "airing", airingId: a, label: l })}
            />
            <RecentlyPlayed timeline={timeline} onHistory={(a, l) => setModal({ kind: "airing", airingId: a, label: l })} />
          </div>

          <aside className="sch-rail" aria-label="Controls and health">
            {channel.enabled ? (
              <LiveControls
                slug={channel.slug}
                busy={busy}
                disabled={!timeline?.on_air}
                timeline={timeline}
                onPick={(mode) => setModal({ kind: "picker", mode, airingId: mode === "replace" ? timeline?.up_next[0]?.airing_id : undefined })}
                onSkip={() => act({ action: "skip" })}
                onBack={() => act({ action: "back_on_schedule" })}
                onJingle={(id) => act({ action: "insert_jingle", item: { audio_asset_id: id } })}
                onRecorded={afterChange}
                onError={onError}
              />
            ) : (
              <ShadowPanel channel={channel} onEnable={() => setModal({ kind: "enable", on: true })} />
            )}
            {channel.enabled && (
              <VoicesDrawer
                voices={voices}
                channelId={channel.id}
                busy={busy}
                onDone={(message) => {
                  setToast({ message, tone: "info" });
                  loadVoices();
                  loadTimeline();
                  loadOverview();
                }}
                onError={onError}
              />
            )}
            <HealthRail checks={health} focus={focus} onFocus={setFocus} onRefresh={() => loadHealth(true)} onFallback={(slug) => { setFocus(slug); setModal({ kind: "fallback" }); }} onVersions={(slug) => { setFocus(slug); setModal({ kind: "versions" }); }} />
          </aside>
        </div>
      )}

      <Toast toast={toast} onUndo={undo} onClose={() => setToast(null)} />

      {modal?.kind === "picker" && focus && (
        <LibraryPicker
          channelSlug={focus}
          title={{ play_now: "Play now", insert_next: "Insert next", replace: "Replace with…", fallback: "Add to the emergency playlist", jingle: "Insert a jingle" }[modal.mode]}
          actionLabel={{ play_now: "Play now", insert_next: "Insert next", replace: "Replace", fallback: "Add", jingle: "Insert next" }[modal.mode]}
          initialType={modal.mode === "jingle" ? "ids" : "songs"}
          onClose={() => setModal(null)}
          onPick={(r) => {
            const item = r.track_id ? { track_id: r.track_id } : { audio_asset_id: r.audio_asset_id! };
            setModal(null);
            if (modal.mode === "replace") void act({ action: "replace", airing_id: modal.airingId, item });
            else if (modal.mode === "jingle") void act({ action: "insert_jingle", item });
            else void act({ action: modal.mode as "play_now" | "insert_next", item });
          }}
        />
      )}
      {modal?.kind === "preview" && timeline && <PreviewModal slug={timeline.channel.slug} name={timeline.channel.name} onClose={() => setModal(null)} />}
      {modal?.kind === "versions" && focus && (
        <VersionHistory
          slug={focus}
          canRollBack={!!channel?.enabled}
          onClose={() => setModal(null)}
          onRolledBack={(res) => {
            setModal(null);
            afterChange(res);
          }}
          onError={onError}
        />
      )}
      {modal?.kind === "airing" && focus && <AiringHistory slug={focus} airingId={modal.airingId} label={modal.label} onClose={() => setModal(null)} />}
      {modal?.kind === "fallback" && focus && channel && <FallbackEditor slug={focus} name={channel.name} onClose={() => { setModal(null); loadHealth(true); }} />}
      {modal?.kind === "enable" && channel && (
        <EnableDialog
          channel={channel}
          on={modal.on}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setToast({ message: msg });
            loadOverview();
            loadTimeline();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ channel strip

function ChannelStrip({ channels, focus, onFocus, now }: { channels: OverviewChannel[] | null; focus: string | null; onFocus: (s: string) => void; now: number }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!channels) return <p className="sch-dim">Loading channels…</p>;
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = channels.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onFocus(channels[next].slug);
    refs.current[next]?.focus();
  };
  return (
    <div className="sch-strip" role="tablist" aria-label="Channels">
      {channels.map((c, i) => {
        const on = c.on_air;
        const left = on ? on.ends_at_ms - now : 0;
        const pct = on ? Math.min(100, Math.max(0, ((now - on.starts_at_ms) / (on.ends_at_ms - on.starts_at_ms)) * 100)) : 0;
        return (
          <button
            key={c.slug}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            aria-selected={focus === c.slug}
            tabIndex={focus === c.slug ? 0 : -1}
            className={`sch-card-ch${focus === c.slug ? " is-on" : ""}`}
            onClick={() => onFocus(c.slug)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="sch-card-top">
              <span className={`sch-dot is-${c.health}`} aria-label={HEALTH_LABEL[c.health]} role="img" />
              <span className="sch-card-name">{c.name}</span>
            </span>
            <span className={`sch-state is-${c.state}`}>
              {c.state === "shadow" && c.shadow.checks ? `SHADOW · ${((1 - c.shadow.mismatches / c.shadow.checks) * 100).toFixed(1)}% match` : STATE_LABEL[c.state]}
            </span>
            <span className="sch-card-now">
              {on ? (
                <>
                  <Bars /> <span className="sch-card-title">{on.label}</span>
                </>
              ) : (
                <span className="sch-dim">Nothing scheduled</span>
              )}
            </span>
            {on && (
              <span className="sch-card-progress" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </span>
            )}
            <span className="sch-card-foot">
              <span>{on ? `${clock(left)} left` : ""}</span>
              <span>{c.live_version ? `v${c.live_version}` : ""}</span>
            </span>
            {c.grid.mismatch ? (
              <span className="sch-card-grid is-bad">Grid says {c.grid.mismatch.expected}, not playing</span>
            ) : (
              <span className="sch-card-grid">{c.grid.now ? `${c.grid.now.name} · until ${hm(c.grid.now.end_ms)}` : "Channel default"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChannelMenu({ enabled, onFallback, onDisable }: { enabled: boolean; onFallback: () => void; onDisable: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="sch-menu" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" className="sch-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Channel menu" onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="sch-menu-list" role="menu">
          <button role="menuitem" type="button" onClick={() => { setOpen(false); onFallback(); }}>
            Fallback playlist…
          </button>
          {enabled && (
            <button role="menuitem" type="button" onClick={() => { setOpen(false); onDisable(); }}>
              Take the Scheduler off air…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ now and next

function GridLine({ timeline, channel }: { timeline: Timeline | null; channel: OverviewChannel }) {
  const g = timeline?.grid ?? channel.grid;
  return (
    <div className={`sch-gridline${g.mismatch ? " is-bad" : ""}`}>
      {g.now ? (
        <span>
          <strong>ON THE GRID:</strong> {g.now.name.toUpperCase()} · {hm(g.now.start_ms)}–{hm(g.now.end_ms)} · {g.now.description}
        </span>
      ) : (
        <span>
          <strong>ON THE GRID:</strong> CHANNEL DEFAULT
        </span>
      )}
      {g.next && <span className="sch-dim">Next: {g.next.name} at {hm(g.next.start_ms)}</span>}
      {g.mismatch && <span className="sch-bad-text">Grid says {g.mismatch.expected}, but it isn't playing.</span>}
    </div>
  );
}

function NowPlayingCard({ item, channel, now, onHistory }: { item: SchedItem | null; channel: OverviewChannel; now: number; onHistory: (a: string, l: string | null) => void }) {
  const [why, setWhy] = useState(false);
  if (!item) {
    return (
      <section className="sch-now is-empty" aria-label="On air">
        <p>
          {channel.state === "fallback"
            ? "The log doesn't cover now, so listeners are hearing this channel's emergency playlist. The generator keeps retrying; Schedule health says why."
            : channel.horizon_ms
              ? "The log doesn't cover now: listeners hear the emergency playlist, or the old playback if there isn't one."
              : "Nothing is scheduled on this channel."}
        </p>
      </section>
    );
  }
  const total = item.ends_at_ms - item.starts_at_ms;
  const elapsed = Math.max(0, now - item.starts_at_ms);
  const pct = Math.min(100, (elapsed / total) * 100);
  return (
    <section className="sch-now" aria-label="On air">
      {item.artwork_url ? <img className="sch-now-art" src={mediaUrl(item.artwork_url)} alt="" /> : <div className="sch-now-art is-blank" aria-hidden="true" />}
      <div className="sch-now-body">
        <p className="sch-now-kicker">
          <span className="sch-live-dot" aria-hidden="true" /> {channel.enabled ? "ON AIR" : "IN THE LOG (SHADOW)"} · {channel.name.toUpperCase()} · {item.chip}
        </p>
        <h3 className="sch-now-title">{item.label}</h3>
        <p className="sch-dim">{[item.artist, item.album, item.source_line].filter(Boolean).join(" · ")}</p>
        <div className="sch-now-time">
          <span className="sch-now-left" aria-label={`${clock(item.ends_at_ms - now)} left`}>
            -{clock(item.ends_at_ms - now)}
          </span>
          <div className="sch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(elapsed / 1000)} aria-label="Progress">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="sch-dim sch-now-lens">
            {clock(elapsed)} / {clock(total)}
            {item.trimmed_ms > 0 && ` · fades ${clock(item.trimmed_ms)} early`}
          </span>
        </div>
        <div className="sch-now-actions">
          <button type="button" className="sch-link" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
            Why is this playing?
          </button>
          <button type="button" className="sch-link" onClick={() => onHistory(item.airing_id, item.label)}>
            History
          </button>
        </div>
        {why && (
          <ul className="sch-why">
            {item.reasons.length ? item.reasons.map((r, i) => <li key={i}>{r}</li>) : <li>From the channel's regular schedule.</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

function UpNext({
  timeline,
  now,
  controls,
  onReplace,
  onHistory,
}: {
  timeline: Timeline | null;
  now: number;
  controls: boolean;
  onReplace: (airingId: string) => void;
  onHistory: (a: string, l: string | null) => void;
}) {
  const items = (timeline?.up_next ?? []).filter((i) => i.starts_at_ms > now - 1000).slice(0, 10);
  let prevBlock = timeline?.on_air?.block?.id ?? null;
  return (
    <section className="sch-section" aria-labelledby="sch-next-h">
      <div className="sch-section-head">
        <h3 id="sch-next-h" className="sch-h3">
          Up next
        </h3>
        {timeline?.recovery ? (
          <span className="sch-drift is-amber">Recovering: {hm(timeline.recovery.anchor_ms)} starts on time</span>
        ) : (
          <span className="sch-drift is-green">On schedule</span>
        )}
      </div>
      {items.length === 0 && <p className="sch-dim">Nothing coming up in the log.</p>}
      <ol className="sch-next">
        {items.map((i) => {
          const divider = i.block && i.block.id !== prevBlock ? i.block : null;
          const ended = !i.block && prevBlock ? true : false;
          prevBlock = i.block?.id ?? null;
          return (
            <li key={i.airing_id}>
              {divider && (
                <div className="sch-divider">
                  {hm(i.starts_at_ms)} · {divider.name.toUpperCase()} · HARD START
                </div>
              )}
              {ended && <div className="sch-divider is-default">{hm(i.starts_at_ms)} · CHANNEL DEFAULT</div>}
              <div className="sch-next-row">
                <span className="sch-next-time">{hms(i.starts_at_ms)}</span>
                <span className={`sch-chip-type is-${i.chip.toLowerCase()}`}>{i.chip}</span>
                <span className="sch-next-main">
                  <span className="sch-next-title">{i.label}</span>
                  <span className="sch-dim">{i.source_line}{i.trimmed_ms > 0 ? ` · fades ${clock(i.trimmed_ms)} early` : ""}</span>
                </span>
                <span className="sch-next-len">{clock(i.ends_at_ms - i.starts_at_ms)}</span>
                <RowMenu label={i.label} canReplace={controls} onReplace={() => onReplace(i.airing_id)} onHistory={() => onHistory(i.airing_id, i.label)} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RowMenu({ label, canReplace, onReplace, onHistory }: { label: string | null; canReplace: boolean; onReplace: () => void; onHistory: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="sch-menu" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" className="sch-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${label ?? "this item"}`} onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <div className="sch-menu-list" role="menu">
          {canReplace && (
            <button role="menuitem" type="button" onClick={() => { setOpen(false); onReplace(); }}>
              Replace…
            </button>
          )}
          <button role="menuitem" type="button" onClick={() => { setOpen(false); onHistory(); }}>
            History
          </button>
        </div>
      )}
    </div>
  );
}

function RecentlyPlayed({ timeline, onHistory }: { timeline: Timeline | null; onHistory: (a: string, l: string | null) => void }) {
  const rows = timeline?.recent ?? [];
  return (
    <section className="sch-section sch-recent" aria-labelledby="sch-recent-h">
      <h3 id="sch-recent-h" className="sch-h3">
        Recently played
      </h3>
      {rows.length === 0 && <p className="sch-dim">Nothing recorded yet. The aired record starts when the Scheduler is on air.</p>}
      <ol className="sch-next is-dim">
        {rows.map((r) => (
          <li key={r.airing_id}>
            <button type="button" className="sch-next-row is-button" onClick={() => onHistory(r.airing_id, r.label)}>
              <span className="sch-next-time">{hms(r.starts_at_ms)}</span>
              <span className="sch-next-main">
                <span className="sch-next-title">{r.label}</span>
              </span>
              {r.ended_how === "skipped" && <span className="sch-tag is-amber">Skipped</span>}
              {r.ended_how === "interrupted" && <span className="sch-tag is-amber">Interrupted</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------ rail

function LiveControls({
  slug,
  busy,
  disabled,
  timeline,
  onPick,
  onSkip,
  onBack,
  onJingle,
  onRecorded,
  onError,
}: {
  slug: string;
  busy: boolean;
  disabled: boolean;
  timeline: Timeline | null;
  onPick: (mode: "play_now" | "insert_next" | "replace" | "jingle") => void;
  onSkip: () => void;
  onBack: () => void;
  onJingle: (assetId: string) => void;
  onRecorded: (res: { version: number; previous: number; message: string }) => void;
  onError: (err: unknown) => void;
}) {
  const [jingles, setJingles] = useState<{ audio_asset_id: string; title: string }[]>([]);
  useEffect(() => {
    schedApi
      .topJingles(slug)
      .then((r) => setJingles(r.results))
      .catch(() => setJingles([]));
  }, [slug]);
  const off = busy || disabled;
  return (
    <section className="sch-card" aria-labelledby="sch-live-h">
      <h3 id="sch-live-h" className="sch-eyebrow">
        Live controls
      </h3>
      <button type="button" className="sch-btn sch-btn-red sch-btn-block" disabled={off} onClick={() => onPick("play_now")}>
        Play now…
      </button>
      <div className="sch-control-row">
        <button type="button" className="sch-btn" disabled={off} onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="sch-btn" disabled={off} onClick={() => onPick("insert_next")}>
          Insert next…
        </button>
        <button type="button" className="sch-btn" disabled={off || !timeline?.up_next.length} onClick={() => onPick("replace")} title="Replaces the next item. To replace a later one, use ⋯ on its row in Up next.">
          Replace…
        </button>
      </div>
      <p className="sch-eyebrow sch-eyebrow-sub">Insert jingle</p>
      <div className="sch-chips">
        {jingles.map((j) => (
          <button key={j.audio_asset_id} type="button" className="sch-chip" disabled={off} onClick={() => onJingle(j.audio_asset_id)}>
            {j.title}
          </button>
        ))}
        <button type="button" className="sch-chip" disabled={off} onClick={() => onPick("jingle")}>
          More…
        </button>
      </div>
      <RecordLink slug={slug} expected={timeline?.live_version ?? 0} disabled={off} onDone={onRecorded} onError={onError} />
      <button type="button" className="sch-btn sch-btn-block" disabled={off} onClick={onBack}>
        Back on schedule
      </button>
    </section>
  );
}

/** Approved listener voice notes for this channel, each with Play next (handoff_say_it_on_air.md §10). */
function VoicesDrawer({ voices, channelId, busy, onDone, onError }: { voices: any[]; channelId: string; busy: boolean; onDone: (message: string) => void; onError: (e: unknown) => void }) {
  const [working, setWorking] = useState<string | null>(null);
  const playNext = async (v: any) => {
    setWorking(v.id);
    try {
      const r = await onAirStudioApi.approve(v.id, { channel_id: channelId, when: "next", play_song_after: !!v.play_song_after });
      onDone(`${v.first_name}: ${r.message}`);
    } catch (err) {
      onError(err);
    } finally {
      setWorking(null);
    }
  };
  return (
    <section className="sch-card" id="sch-voices" aria-labelledby="sch-voices-h">
      <h3 id="sch-voices-h" className="sch-eyebrow">
        Voices {voices.length ? `(${voices.length})` : ""}
      </h3>
      {voices.length === 0 ? (
        <p className="sch-dim">
          No approved voice notes waiting. <Link to="/studio/on-air">Listener voices →</Link>
        </p>
      ) : (
        <div className="oas-drawer">
          {voices.map((v) => (
            <div key={v.id} className="oas-drawer-row">
              <span>
                <strong>
                  {v.first_name}
                  {v.place ? ` in ${v.place}` : ""}
                </strong>
                <span className="sch-dim">
                  {" "}
                  · {v.seconds ? `${v.seconds} s` : ""}
                  {v.kind === "dedication" && v.for_name ? ` · for ${v.for_name}` : ""}
                  {v.play_song_after && v.requested_track_title ? ` · then ${v.requested_track_title}` : ""}
                </span>
                {v.flag && <span className="oas-flag"> {v.flag}</span>}
              </span>
              <button type="button" className="sch-btn" disabled={busy || working !== null} onClick={() => void playNext(v)}>
                {working === v.id ? "Placing..." : "Play next"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const MAX_RECORD_SECONDS = 120;

function RecordLink({ slug, expected, disabled, onDone, onError }: { slug: string; expected: number; disabled: boolean; onDone: (r: { version: number; previous: number; message: string }) => void; onError: (e: unknown) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef(0);
  const started = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const expectedRef = useRef(expected);
  expectedRef.current = expected;

  const stop = () => {
    window.clearInterval(timer.current);
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  };
  useEffect(() => () => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError(new ApiError(0, "mic", { friendly: "Couldn't use the microphone. Allow microphone access for this site in your browser, then try again." }));
      return;
    }
    const r = new MediaRecorder(stream.current);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    r.onstop = async () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      setState("saving");
      try {
        const wav = await recordingToWav(new Blob(chunks.current, { type: r.mimeType }));
        onDone(await schedApi.recordLink(slug, wav.blob, wav.seconds, expectedRef.current));
      } catch (err) {
        onError(err);
      } finally {
        setState("idle");
      }
    };
    rec.current = r;
    r.start();
    started.current = Date.now();
    setSeconds(0);
    setState("recording");
    timer.current = window.setInterval(() => {
      const s = (Date.now() - started.current) / 1000;
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 200);
  };

  if (state === "recording") {
    return (
      <button type="button" className="sch-btn sch-btn-rec sch-btn-block" onClick={stop}>
        <span className="sch-rec-dot" aria-hidden="true" /> REC {clock(seconds * 1000)} · Stop and insert next
      </button>
    );
  }
  return (
    <button type="button" className="sch-btn sch-btn-block" disabled={disabled || state === "saving"} onClick={() => void start()}>
      {state === "saving" ? "Saving the link…" : "Record a link, then insert next"}
    </button>
  );
}

function ShadowPanel({ channel, onEnable }: { channel: OverviewChannel; onEnable: () => void }) {
  const s = channel.shadow;
  return (
    <section className="sch-card" aria-labelledby="sch-shadow-h">
      <h3 id="sch-shadow-h" className="sch-eyebrow">
        Shadow mode
      </h3>
      <p>
        Listeners still hear the old playback. The Scheduler builds this channel's log alongside it and checks, every minute, that the two agree.
      </p>
      <p className="sch-big">
        {s.checks ? `Matches ${(s.checks - s.mismatches).toLocaleString("en-GB")} of ${s.checks.toLocaleString("en-GB")} checks` : "No checks yet"}
      </p>
      {s.since_ms && <p className="sch-dim">Checking since {dayHm(s.since_ms)}.</p>}
      {s.paused_until_ms && <p className="sch-dim">Paused for a library change until {hm(s.paused_until_ms)}.</p>}
      <button type="button" className="sch-btn sch-btn-red sch-btn-block" disabled={!s.eligibility.ok} onClick={onEnable} aria-describedby="sch-elig">
        Put the Scheduler on air
      </button>
      <p id="sch-elig" className="sch-dim">
        {s.eligibility.reason} Live controls and the weekly grid unlock once it's on air.
      </p>
    </section>
  );
}

function HealthRail({
  checks,
  focus,
  onFocus,
  onRefresh,
  onFallback,
  onVersions,
}: {
  checks: HealthCheck[] | null;
  focus: string | null;
  onFocus: (slug: string) => void;
  onRefresh: () => void;
  onFallback: (slug: string) => void;
  onVersions: (slug: string) => void;
}) {
  const [showGreen, setShowGreen] = useState(false);
  const problems = checks?.filter((c) => c.level === "red" || c.level === "amber") ?? [];
  const fine = checks?.filter((c) => c.level === "green") ?? [];
  return (
    <section id="sch-health" tabIndex={-1} className="sch-card sch-health-card" aria-labelledby="sch-health-h">
      <div className="sch-section-head">
        <h3 id="sch-health-h" className="sch-eyebrow">
          Schedule health
        </h3>
        <button type="button" className="sch-link" onClick={onRefresh}>
          Check now
        </button>
      </div>
      {!checks && <p className="sch-dim">Checking…</p>}
      {checks && problems.length === 0 && <p className="sch-ok">Everything's fine for the next 48 hours.</p>}
      <ul className="sch-health">
        {problems.map((c) => (
          <li key={`${c.channelId}:${c.id}`} className={`is-${c.level}`}>
            <span className={`sch-dot is-${c.level}`} aria-hidden="true" />
            <div>
              <strong>
                {c.channelName}: {c.title}
              </strong>
              <p>{c.detail}</p>
              <div className="sch-health-actions">
                {c.channelSlug !== focus && (
                  <button type="button" className="sch-link" onClick={() => onFocus(c.channelSlug)}>
                    Review
                  </button>
                )}
                {c.action === "fallback" && (
                  <button type="button" className="sch-link" onClick={() => onFallback(c.channelSlug)}>
                    Fix fallback
                  </button>
                )}
                {(c.action === "review" || c.action === "history") && (
                  <button type="button" className="sch-link" onClick={() => onVersions(c.channelSlug)}>
                    Open history
                  </button>
                )}
                {c.action === "grid" && (
                  <Link className="sch-link" to={`/studio/scheduler/timeline?view=week&channel=${c.channelSlug}`}>
                    Open the grid
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {fine.length > 0 && (
        <button type="button" className="sch-link" aria-expanded={showGreen} onClick={() => setShowGreen((s) => !s)}>
          {showGreen ? "Hide" : "Show"} {fine.length} checks that are fine
        </button>
      )}
      {showGreen && (
        <ul className="sch-health is-green">
          {fine.map((c) => (
            <li key={`${c.channelId}:${c.id}`}>
              <span className="sch-dot is-green" aria-hidden="true" />
              <div>
                <strong>
                  {c.channelName}: {c.title}
                </strong>
                <p>{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ dialogs

function PreviewModal({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [items, setItems] = useState<SchedItem[] | null>(null);
  useEffect(() => {
    schedApi.timeline(slug, 120).then((t) => setItems([...(t.on_air ? [t.on_air] : []), ...t.up_next.filter((i) => i.starts_at_ms < Date.now() + 2 * 3600_000)])).catch(() => setItems([]));
  }, [slug]);
  return (
    <Modal title={`${name}: the next 2 hours`} onClose={onClose} wide>
      {!items && <p className="sch-dim">Loading…</p>}
      <table className="sch-table">
        <thead>
          <tr>
            <th scope="col">Starts</th>
            <th scope="col">Type</th>
            <th scope="col">Title</th>
            <th scope="col">From</th>
            <th scope="col">Length</th>
          </tr>
        </thead>
        <tbody>
          {items?.map((i) => (
            <tr key={i.airing_id}>
              <td>{hms(i.starts_at_ms)}</td>
              <td>{i.chip}</td>
              <td>{i.label}</td>
              <td className="sch-dim">{i.source_line}</td>
              <td>{clock(i.ends_at_ms - i.starts_at_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function EnableDialog({ channel, on, onClose, onDone }: { channel: OverviewChannel; on: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      await schedApi.enable(channel.slug, on);
      onDone(on ? `${channel.name} now plays from the Scheduler.` : `${channel.name} is back on the old playback.`);
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={on ? `Put the Scheduler on air for ${channel.name}?` : `Take the Scheduler off air for ${channel.name}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`sch-btn ${on ? "sch-btn-red" : ""}`} onClick={() => void go()} disabled={busy}>
            {on ? "Put it on air" : "Take it off air"}
          </button>
        </>
      }
    >
      {on ? (
        <>
          <p>Listeners will hear this channel's log. Live controls and the weekly grid unlock.</p>
          <p className="sch-dim">Best done at night: every open player reloads its current song once, as the item IDs change over.</p>
        </>
      ) : (
        <p>Listeners go straight back to the old playback. The log keeps being built in shadow, so you can put it back on air any time.</p>
      )}
      {error && (
        <p className="sch-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

