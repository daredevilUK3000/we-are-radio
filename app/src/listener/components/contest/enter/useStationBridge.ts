import { useCallback, useEffect, useRef, useState } from "react";
import { trackListenNow } from "../../../../shared/analytics";

/**
 * "Listen now" on the Top 3 entry page, without a second audio player.
 * NowPlayingBar owns the station's one <audio> element; this talks to it
 * through window events (the same pattern as "open-vibe-shift"):
 *
 *   war:player               { action: "toggle" | "play" | "pause" }  - commands in
 *   war:player-state         { onAir, playing, title, ... }           - state out
 *   war:player-state-request                                          - "tell me now"
 *
 * so the hero button, the aside card and the bottom bar always agree.
 */
export interface StationState {
  onAir: boolean;
  playing: boolean;
  title: string | null;
  channelName: string | null;
  artworkUrl: string | null;
}

const OFF_AIR: StationState = { onAir: false, playing: false, title: null, channelName: null, artworkUrl: null };

export function useStationBridge() {
  const [state, setState] = useState<StationState>(OFF_AIR);
  const tracked = useRef(false);

  useEffect(() => {
    const onState = (e: Event) => setState({ ...OFF_AIR, ...(e as CustomEvent).detail });
    window.addEventListener("war:player-state", onState);
    // The bar may have mounted (and announced itself) before this page did.
    window.dispatchEvent(new Event("war:player-state-request"));
    return () => window.removeEventListener("war:player-state", onState);
  }, []);

  // Must be called straight from a click: the bar's play() runs synchronously
  // inside this dispatch, which is what lets iOS start the audio.
  const toggle = useCallback(() => {
    if (!state.playing && !tracked.current) {
      tracked.current = true;
      trackListenNow();
    }
    window.dispatchEvent(new CustomEvent("war:player", { detail: { action: "toggle" } }));
  }, [state.playing]);

  return { ...state, toggle };
}
