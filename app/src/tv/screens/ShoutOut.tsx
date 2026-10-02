import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { trackTv } from "../../shared/analytics";
import { Icon, TvButton } from "../components";
import { useTvPlayer } from "../TvPlayer";
import { stillFor } from "../tvData";
import { goBack } from "../tvUi";

/** Screen 5: Send a shout out (handoff_tv_firetv.md §A8): a QR code to record on the phone. */
export function ShoutOut() {
  const navigate = useNavigate();
  const player = useTvPlayer();
  const { ref, focusKey } = useFocusable({ focusKey: "tv-shout", trackChildren: true });

  useEffect(() => {
    trackTv("tv_shout_out_qr_shown", player.data?.channel?.id ?? null);
    const t = window.setTimeout(() => setFocus("tv-shout-done"), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="tv-screen tv-shout">
        <div className="tv-bg">
          <img className="tv-bg-media tv-shout-blur" src={stillFor(player.slug)} alt="" />
        </div>
        <div className="tv-shout-panel">
          <div className="tv-shout-left">
            {/* "Send a shout out" everywhere, at Kizzi's request (1 Oct 2026), rather than the handoff's "Say it on air". */}
            <div className="tv-shout-eyebrow">{Icon.mic} On We Are Radio</div>
            <h1 className="tv-shout-title">Send a shout out</h1>
            <p className="tv-shout-line">Record a shout out, a dedication or your take on a song, in your own voice.</p>
            <ol className="tv-shout-steps">
              <li>Scan the code with your phone</li>
              <li>Record up to 45 seconds</li>
              <li>Kizzi listens. If it's picked, you're on air</li>
            </ol>
            <div className="tv-shout-actions">
              <TvButton focusKey="tv-shout-done" primary onPress={() => goBack(navigate)}>
                Done
              </TvButton>
              <span className="tv-shout-or">
                Or go to <strong>weareradio.app/on-air</strong>
              </span>
            </div>
          </div>
          <div className="tv-shout-right">
            <div className="tv-qr">
              <img src="/tv/qr-on-air.svg" alt="QR code for weareradio.app/on-air" width={320} height={320} />
            </div>
            <div className="tv-qr-caption">Point your phone's camera here</div>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
