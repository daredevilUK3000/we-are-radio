/**
 * Sharing (handoff: shareable links). A generated share link always carries
 * ?ref=share, so the Studio Analytics Visitors tab can break out how much
 * listening comes from a shared link versus YouTube, a podcast mention, or
 * organic traffic - it's read back by shared/analytics.ts's visitSource(),
 * which already buckets visits by where they came from, so no separate
 * tracking was needed for this.
 */
export function shareUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("ref", "share");
  return url.toString();
}

export type ShareOutcome = "shared" | "copied" | "cancelled";

/**
 * navigator.share() where the browser has it (the native share sheet - the
 * best experience, especially on a phone), otherwise copies the link to the
 * clipboard. Never throws: a share the listener cancels, or a browser with
 * neither API, both resolve rather than reject.
 */
export async function share(opts: { url: string; title: string; text?: string }): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share(opts);
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "cancelled"; // the listener closed the share sheet
      // some browsers reject share() for other reasons (e.g. not called from a fresh gesture) - fall through to copying
    }
  }
  try {
    await navigator.clipboard.writeText(opts.url);
    return "copied";
  } catch {
    return "cancelled";
  }
}
