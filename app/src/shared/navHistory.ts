/**
 * The listener page someone was on before the contact page, for its "Which
 * page?" pre-fill. document.referrer can't tell us: moving around inside the
 * app never changes it. ListenerLayout records every page here.
 */
let lastOtherPage: string | null = null;

export function rememberPage(path: string) {
  if (!path.startsWith("/contact")) lastOtherPage = path;
}

/** The last page on this site before /contact, as a full address, or null if there wasn't one. */
export function previousPage(): string | null {
  if (lastOtherPage) return `${window.location.origin}${lastOtherPage}`;
  // Arrived from another tab or a bookmark: the referrer, if it's one of ours.
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && (ref.hostname === "weareradio.app" || ref.origin === window.location.origin) && !ref.pathname.startsWith("/contact")) {
      return ref.href;
    }
  } catch {
    // unreadable referrer: no pre-fill
  }
  return null;
}
