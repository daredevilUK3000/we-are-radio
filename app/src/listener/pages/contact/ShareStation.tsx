import { useState } from "react";
import { useCopy } from "./useCopy";
import { IconCopy, IconShare } from "./icons";

const STATION_URL = "https://weareradio.app/";

/** Shares the station itself, not this page. */
export function ShareStation() {
  const { copied, copy } = useCopy();
  const [shareNote, setShareNote] = useState<string | null>(null);

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "We Are Radio", text: "Music, talk and real people. Have a listen:", url: STATION_URL });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // closed the share sheet
        // any other refusal: copy instead
      }
    }
    if (await copy(STATION_URL)) {
      setShareNote("Link copied");
      window.setTimeout(() => setShareNote(null), 2500);
    }
  };

  return (
    <section className="c3p-share" aria-labelledby="c3p-share-h">
      <span className="c3p-share-fm" aria-hidden="true">
        FM
      </span>
      <div className="c3p-share-copy">
        <p className="c3p-eyebrow c3p-eyebrow-soft">Pass it on</p>
        <h2 id="c3p-share-h" className="c3p-h2 c3p-h2-share">
          Know someone who'd love <span className="c3p-sheen">We Are Radio?</span>
        </h2>
        <p className="c3p-share-text">Send them the station. Music, talk and real people, from a studio in France to wherever they are.</p>
      </div>
      <div className="c3p-share-btns">
        <button type="button" className="c3p-btn c3p-btn-red c3p-btn-share" onClick={() => void onShare()}>
          <IconShare />
          {shareNote ?? "Share We Are Radio"}
        </button>
        <button type="button" className="c3p-btn c3p-btn-ghost c3p-btn-copy" onClick={() => void copy(STATION_URL)}>
          <IconCopy />
          {copied && !shareNote ? "Link copied" : "Copy the link"}
        </button>
        <span className="c3p-sr" role="status">
          {copied ? "Link copied" : ""}
        </span>
      </div>
    </section>
  );
}
