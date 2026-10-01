// One-off: the QR code on the TV's "Send a shout out" screen
// (handoff_tv_firetv.md §A8). Run with `node scripts/make-tv-qr.mjs` from app/
// when the target changes; the SVG is committed, so nothing runs at page load.
import QRCode from "qrcode";
import { writeFileSync } from "node:fs";

const TARGET = "https://weareradio.app/on-air?src=tv";
const svg = await QRCode.toString(TARGET, { type: "svg", errorCorrectionLevel: "M", margin: 0, width: 320, color: { dark: "#08080a", light: "#ffffff" } });
// qrcode's SVG already sets shape-rendering="crispEdges" (sharp modules at any scale).
writeFileSync("public/tv/qr-on-air.svg", svg);
console.log("Wrote public/tv/qr-on-air.svg for", TARGET);
