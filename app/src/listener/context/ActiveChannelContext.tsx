import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentTimeOfDayChannel } from "../lib/timeOfDay";
import { publicApi } from "../../api/client";
import type { TimeOfDayBand } from "../../shared/moods";

const OVERRIDE_KEY = "we-are-radio:vibe-shift-channel";
// Where the player goes when the channel it would otherwise pick is switched
// off in the Studio (channels.status isn't 'live').
const FALLBACK_CHANNEL = "kizzi-radio";

interface ActiveChannelState {
  channelSlug: string;
  band: TimeOfDayBand;
  isOverridden: boolean;
  /** Slugs of the channels switched on in the Studio; null until loaded. */
  liveSlugs: string[] | null;
  setOverride: (slug: string) => void;
  clearOverride: () => void;
}

const ActiveChannelContext = createContext<ActiveChannelState | null>(null);

// Phase 3 (handoff_radio_brain_roadmap.md): the main player's default
// channel, driven by the listener's local time unless they've picked one
// themselves via Vibe Shift. The override lives in localStorage rather
// than an account, consistent with the rest of the app's no-account model
// (Phase 2 sessions, favourites are the one deliberate exception to that).
export function ActiveChannelProvider({ children }: { children: ReactNode }) {
  const [override, setOverrideState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OVERRIDE_KEY);
    } catch {
      return null;
    }
  });
  const [auto, setAuto] = useState(() => currentTimeOfDayChannel());
  const [liveSlugs, setLiveSlugs] = useState<string[] | null>(null);

  // Which channels are switched on. Re-checked every few minutes so a channel
  // hidden in the Studio drops out of an open tab without a reload.
  useEffect(() => {
    const load = () =>
      publicApi
        .channels()
        .then((r) => setLiveSlugs(r.channels.map((ch) => ch.slug)))
        .catch(() => {});
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Re-check every minute so the main player actually shifts live if left
  // open across a time-band boundary, not just on the next page load.
  useEffect(() => {
    const id = setInterval(() => setAuto(currentTimeOfDayChannel()), 60_000);
    return () => clearInterval(id);
  }, []);

  const setOverride = useCallback((slug: string) => {
    setOverrideState(slug);
    try {
      localStorage.setItem(OVERRIDE_KEY, slug);
    } catch {
      // best-effort - a blocked/full localStorage just means the override
      // won't survive a reload, not a broken feature
    }
  }, []);

  const clearOverride = useCallback(() => {
    setOverrideState(null);
    try {
      localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      // see above
    }
  }, []);

  const value = useMemo<ActiveChannelState>(() => {
    // The time-of-day pick (or a Vibe Shift pick saved earlier) may be a
    // channel that's switched off - then Kizzi Radio plays instead, so the
    // player never disappears just because it's the afternoon.
    const preferred = override ?? auto.channelSlug;
    const channelSlug =
      liveSlugs === null || liveSlugs.includes(preferred)
        ? preferred
        : liveSlugs.includes(FALLBACK_CHANNEL) || liveSlugs.length === 0
          ? FALLBACK_CHANNEL
          : liveSlugs[0];
    return {
      channelSlug,
      band: auto.band,
      isOverridden: override !== null && channelSlug === override,
      liveSlugs,
      setOverride,
      clearOverride,
    };
  }, [override, auto, liveSlugs, setOverride, clearOverride]);

  return <ActiveChannelContext.Provider value={value}>{children}</ActiveChannelContext.Provider>;
}

export function useActiveChannel(): ActiveChannelState {
  const ctx = useContext(ActiveChannelContext);
  if (!ctx) throw new Error("useActiveChannel must be used within ActiveChannelProvider");
  return ctx;
}
