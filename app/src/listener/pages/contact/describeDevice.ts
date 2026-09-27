/**
 * "Chrome on Windows", "Safari on iPhone"... to pre-fill the "Device and
 * browser" field of a problem report. A best guess the visitor can edit, so
 * no library: the browser's own userAgentData where it has it (Chromium),
 * the user-agent string otherwise.
 */

interface UAData {
  brands?: { brand: string }[];
  platform?: string;
  mobile?: boolean;
}

function browserFromUA(ua: string): string | null {
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Edg(e|A|iOS)?\//i.test(ua)) return "Edge";
  if (/Firefox|FxiOS/i.test(ua)) return "Firefox";
  if (/CriOS|Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return null;
}

function osFromUA(ua: string): string | null {
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  // iPadOS 13+ says "Macintosh" but has a touch screen.
  if (/Macintosh|Mac OS X/i.test(ua)) return navigator.maxTouchPoints > 1 ? "iPad" : "macOS";
  if (/Linux|X11|CrOS/i.test(ua)) return "Linux";
  return null;
}

const PLATFORMS: Record<string, string> = { Windows: "Windows", macOS: "macOS", Android: "Android", Linux: "Linux", "Chrome OS": "Linux", iOS: "iPhone" };

export function describeDevice(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent ?? "";
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;

  let browser: string | null = null;
  let os: string | null = null;
  if (data?.brands?.length) {
    const names = data.brands.map((b) => b.brand);
    if (names.some((n) => /Edge/i.test(n))) browser = "Edge";
    else if (names.some((n) => /Samsung/i.test(n))) browser = "Samsung Internet";
    else if (names.some((n) => /Chrome/i.test(n))) browser = "Chrome";
  }
  if (data?.platform) os = PLATFORMS[data.platform] ?? null;

  browser ??= browserFromUA(ua);
  os ??= osFromUA(ua);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "";
}
