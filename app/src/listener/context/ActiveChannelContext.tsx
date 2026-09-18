import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentTimeOfDayChannel } from "../lib/timeOfDay";
import type { TimeOfDayBand } from "../../shared/moods";

const OVERRIDE_KEY = "we-are-radio:vibe-shift-channel";

interface ActiveChannelState {
  channelSlug: string;
  band: TimeOfDayBand;
  isOverridden: boolean;
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

  const value = useMemo<ActiveChannelState>(
    () => ({
      channelSlug: override ?? auto.channelSlug,
      band: auto.band,
      isOverridden: override !== null,
      setOverride,
      clearOverride,
    }),
    [override, auto, setOverride, clearOverride]
  );

  return <ActiveChannelContext.Provider value={value}>{children}</ActiveChannelContext.Provider>;
}

export function useActiveChannel(): ActiveChannelState {
  const ctx = useContext(ActiveChannelContext);
  if (!ctx) throw new Error("useActiveChannel must be used within ActiveChannelProvider");
  return ctx;
}
