// One-off: the QR codes on the TV's Time Capsule and Top 3 screens (9 Oct 2026),
// in the same style as make-tv-qr.mjs. Run with `node scripts/make-tv-qr-extra.mjs`
// from app/ when a target changes; the SVGs are committed.
import QRCode from "qrcode";
import { writeFileSync } from "node:fs";

const CODES = {
  "public/tv/qr-time-capsule.svg": "https://weareradio.app/time-capsule?src=tv",
  "public/tv/qr-top3.svg": "https://weareradio.app/top3?src=tv",
};
for (const [file, target] of Object.entries(CODES)) {
  const svg = await QRCode.toString(target, { type: "svg", errorCorrectionLevel: "M", margin: 0, width: 320, color: { dark: "#08080a", light: "#ffffff" } });
  writeFileSync(file, svg);
  console.log("Wrote", file, "for", target);
}
