import { useState } from "react";
import { share, shareUrl } from "../../shared/share";

/**
 * A share button used everywhere something can be shared: a track row, an
 * album or channel page, the mini-player, a Radio That Knows You mood card.
 * `path` is the shareable page's own path (e.g. `/albums/abc`) - shareUrl()
 * turns it into an absolute, ?ref=share-tagged link. `title`/`text` are what
 * the native share sheet (or a message someone pastes the link into) shows;
 * the rich preview those platforms build from the link itself comes from
 * server-rendered Open Graph tags on that page (see worker/src/routes/shareLinks.ts),
 * not from anything here.
 *
 * The "Link copied" notice is a child of the button itself (not a sibling
 * wrapper), so it always anchors to the button regardless of how the button
 * is positioned on the page - including when `style` places it absolutely
 * in the corner of a card, as the mood cards on the Radio That Knows You
 * screen do.
 */
export function ShareButton({
  path,
  title,
  text,
  className = "btn",
  label = "Share",
  iconOnly = false,
  style,
}: {
  path: string;
  title: string;
  text?: string;
  className?: string;
  label?: string;
  iconOnly?: boolean;
  style?: React.CSSProperties;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  const onShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const outcome = await share({ url: shareUrl(path), title, text });
    if (outcome === "copied") {
      setNotice("Link copied");
      window.setTimeout(() => setNotice(null), 2500);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={onShare}
      title={iconOnly ? "Share" : undefined}
      aria-label={iconOnly ? "Share" : undefined}
      style={{ position: "relative", ...style }}
    >
      {iconOnly ? "↗" : `↗ ${label}`}
      {notice && (
        <span
          role="status"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            fontSize: "0.75rem",
            fontWeight: 400,
            color: "var(--text-dim)",
            whiteSpace: "nowrap",
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "2px 8px",
            zIndex: 2,
          }}
        >
          {notice}
        </span>
      )}
    </button>
  );
}
