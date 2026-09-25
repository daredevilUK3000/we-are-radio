import { useState } from "react";
import { promptInstall, useInstall } from "../../shared/install";

const DISMISS_KEY = "we-are-radio:install-dismissed";

function ShareIcon() {
  // Safari's Share symbol (a box with an arrow), so iPhone users know what to look for.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share" style={{ verticalAlign: "-3px" }}>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 11v9h14v-9" />
    </svg>
  );
}

/**
 * "Install the app": the browser's own install dialog on Android/desktop
 * Chrome, and Add to Home Screen instructions on iPhone. Shows nothing when
 * the app is already installed, or on browsers that can't install it.
 * `dismissible` (the Home page) lets the listener hide it for good.
 */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const { canPrompt, installed, iosSafari } = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    if (!dismissible) return false;
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (installed || dismissed || (!canPrompt && !iosSafari)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // it just comes back next visit
    }
  };

  return (
    <section className="install-card" aria-label="Install the app">
      <img src="/icons/icon-96.png" alt="" className="install-card-icon" />
      <div className="install-card-text">
        <strong>Get the We Are Radio app</strong>
        {canPrompt ? (
          <span>Opens full screen from your home screen, and plays your downloads offline.</span>
        ) : (
          <span>
            In Safari, tap <ShareIcon /> Share, then <b>Add to Home Screen</b>.
          </span>
        )}
      </div>
      {canPrompt && (
        <button type="button" className="btn primary" onClick={() => void promptInstall()}>
          Install
        </button>
      )}
      {dismissible && (
        <button type="button" className="install-card-close" onClick={dismiss} aria-label="Hide">
          ×
        </button>
      )}
    </section>
  );
}
