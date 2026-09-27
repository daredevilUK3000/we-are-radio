import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

/** Shared bits for the Scheduler screens: sub-navigation, clock, modal, toast, formatting. */

export function SchedulerNav() {
  return (
    <nav className="sch-subnav" aria-label="Scheduler">
      <NavLink to="/studio/scheduler" end>
        Master Control
      </NavLink>
      <NavLink to="/studio/scheduler/grid">Weekly grid</NavLink>
      {/* Timeline, Library, Playlists & templates and Rules arrive in Releases 2 and 3. */}
    </nav>
  );
}

const PARIS = "Europe/Paris";
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, weekday: "short" });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, weekday: "long", day: "numeric", month: "long" });

export const hms = (ms: number) => timeFmt.format(new Date(ms));
export const hm = (ms: number) => hmFmt.format(new Date(ms));
export const dayHm = (ms: number) => `${dayFmt.format(new Date(ms))} ${hmFmt.format(new Date(ms))}`;
export const longDate = (ms: number) => dateFmt.format(new Date(ms));

/** "3:45", "1:02:05" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "Today", "Yesterday" or the weekday, then HH:MM - for "last aired". */
export function whenAgo(ms: number | null | undefined, nowMs: number): string {
  if (!ms) return "Not aired here yet";
  const days = Math.floor((nowMs - ms) / 86_400_000);
  if (days < 1) return `Today ${hm(ms)}`;
  if (days < 2) return `Yesterday ${hm(ms)}`;
  if (days < 7) return dayHm(ms);
  return `${days} days ago`;
}

/** The time now, ticking every second. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A modal on the native <dialog>: focus is kept inside, Esc closes it. */
export function Modal({ title, onClose, children, wide = false, footer }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener("cancel", onCancel);
    return () => d?.removeEventListener("cancel", onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} className={`sch-modal${wide ? " is-wide" : ""}`} aria-labelledby="sch-modal-title">
      <header className="sch-modal-head">
        <h2 id="sch-modal-title">{title}</h2>
        <button type="button" className="sch-icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="sch-modal-body">{children}</div>
      {footer && <footer className="sch-modal-foot">{footer}</footer>}
    </dialog>
  );
}

export interface ToastState {
  message: string;
  tone?: "ok" | "error" | "info";
  /** Rollback target for Undo, and until when it's offered. */
  undo?: { number: number; expected: number; until: number };
}

export function Toast({ toast, onUndo, onClose }: { toast: ToastState | null; onUndo: () => void; onClose: () => void }) {
  const now = useNow(1000);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(onClose, toast.undo ? Math.max(0, toast.undo.until - Date.now()) : 8000);
    return () => window.clearTimeout(id);
  }, [toast, onClose]);
  if (!toast) return null;
  const left = toast.undo ? Math.ceil((toast.undo.until - now) / 1000) : 0;
  return (
    <div className={`sch-toast is-${toast.tone ?? "ok"}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.undo && left > 0 && (
        <button type="button" className="sch-btn sch-btn-sm" onClick={onUndo}>
          Undo ({left}s)
        </button>
      )}
      <button type="button" className="sch-icon-btn" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function Bars({ playing = true }: { playing?: boolean }) {
  return (
    <span className={`sch-bars${playing ? "" : " is-still"}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export const HEALTH_LABEL = { red: "Action needed", amber: "Attention", green: "All clear", grey: "Not scheduled" } as const;
