import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { copyFor } from "../../listener/components/contest/phaseCopy";
import { TvButton } from "../components";
import { useTvPlayer } from "../TvPlayer";
import { useTvContent } from "../tvContent";
import { stillFor } from "../tvData";
import { goBack } from "../tvUi";

/**
 * "Do it on your phone" screens (9 Oct 2026), laid out like Send a shout out:
 * the Time Capsule and the Top 3 contest, each with a QR code. Nothing here
 * can be done with a remote, so the TV explains and hands over to the phone.
 */

function QrScreen({ eyebrow, title, line, steps, qr, qrAlt, url }: { eyebrow: ReactNode; title: string; line: string; steps: string[]; qr: string; qrAlt: string; url: string }) {
  const navigate = useNavigate();
  const player = useTvPlayer();
  const { ref, focusKey } = useFocusable({ focusKey: "tv-qr-screen", trackChildren: true });
  useEffect(() => {
    const t = window.setTimeout(() => setFocus("tv-qr-done"), 50);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="tv-screen tv-shout">
        <div className="tv-bg">
          <img className="tv-bg-media tv-shout-blur" src={stillFor(player.slug)} alt="" />
        </div>
        <div className="tv-shout-panel">
          <div className="tv-shout-left">
            <div className="tv-shout-eyebrow">{eyebrow}</div>
            <h1 className="tv-shout-title">{title}</h1>
            <p className="tv-shout-line">{line}</p>
            <ol className="tv-shout-steps">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="tv-shout-actions">
              <TvButton focusKey="tv-qr-done" primary onPress={() => goBack(navigate)}>
                Done
              </TvButton>
              <span className="tv-shout-or">
                Or go to <strong>{url}</strong>
              </span>
            </div>
          </div>
          <div className="tv-shout-right">
            <div className="tv-qr">
              <img src={qr} alt={qrAlt} width={320} height={320} />
            </div>
            <div className="tv-qr-caption">Point your phone's camera here</div>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export function TimeCapsuleQr() {
  return (
    <QrScreen
      eyebrow="Time Capsule"
      title="A message on the radio, on the day that matters"
      line="A birthday, an anniversary, a day to remember: ask Kizzi for a message, and it plays on air on the day."
      steps={["Scan the code with your phone", "Tell us the day and who it's for", "Kizzi records it, and it's on air on the day"]}
      qr="/tv/qr-time-capsule.svg"
      qrAlt="QR code for weareradio.app/time-capsule"
      url="weareradio.app/time-capsule"
    />
  );
}

export function Top3Qr() {
  const { contest } = useTvContent();
  const copy = contest ? copyFor(contest) : null;
  return (
    <QrScreen
      eyebrow={copy?.eyebrow ?? "Top 3 Creator Songs of 2026"}
      title="Top 3 Creator Songs of 2026"
      line={copy?.lede ?? "Independent creators from anywhere in the world, on We Are Radio."}
      steps={["Scan the code with your phone", "Read the rules and how it works", "Enter your song, or listen to the songs in the running"]}
      qr="/tv/qr-top3.svg"
      qrAlt="QR code for weareradio.app/top3"
      url="weareradio.app/top3"
    />
  );
}
