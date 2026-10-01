import { createContext, useContext } from "react";
import type { NavigateFunction } from "react-router-dom";

/** TV-wide UI state shared with the screens (kept apart from TvApp to avoid a circular import). */
export interface TvUi {
  leanBack: boolean;
  enterLeanBack: () => void;
  /** Videos give way to stills for the session on slow hardware (handoff §A10). */
  stillsOnly: boolean;
  videoLoaded: () => void;
}
export const UiCtx = createContext<TvUi>({ leanBack: false, enterLeanBack: () => {}, stillsOnly: false, videoLoaded: () => {} });
export const useTvUi = () => useContext(UiCtx);

/** Back to the previous TV screen; a deep link with no history goes to Home. */
export function goBack(navigate: NavigateFunction) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate("/tv", { replace: true });
}
