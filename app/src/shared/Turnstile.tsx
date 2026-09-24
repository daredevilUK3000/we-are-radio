import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Cloudflare Turnstile, the "are you a real person?" check on the Top 3
 * contest forms. Managed mode: invisible for most people, a checkbox only
 * when a visitor looks suspicious. The script is loaded once, on the first
 * page that needs it - not site-wide.
 *
 * Tokens are single-use, so the parent calls reset() after every submit
 * attempt, successful or not.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

export const Turnstile = forwardRef<TurnstileHandle, { action: string; onToken: (token: string | null) => void }>(
  function Turnstile({ action, onToken }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

    useImperativeHandle(ref, () => ({
      reset: () => {
        onTokenRef.current(null);
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      },
    }));

    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;
      loadScript()
        .then(() => {
          if (cancelled || !box.current || !window.turnstile) return;
          widgetId.current = window.turnstile.render(box.current, {
            sitekey: siteKey,
            action,
            theme: "dark",
            // A token lasts 5 minutes; renew it quietly rather than fail someone who read the rules first.
            "refresh-expired": "auto",
            callback: (token: string) => onTokenRef.current(token),
            "expired-callback": () => onTokenRef.current(null),
            "error-callback": () => onTokenRef.current(null),
          });
        })
        .catch(() => onTokenRef.current(null));
      return () => {
        cancelled = true;
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      };
    }, [siteKey, action]);

    if (!siteKey) {
      return <p className="tc-error">The "real person" check isn't set up on this copy of the site (VITE_TURNSTILE_SITE_KEY).</p>;
    }
    return <div ref={box} className="turnstile-box" />;
  }
);
