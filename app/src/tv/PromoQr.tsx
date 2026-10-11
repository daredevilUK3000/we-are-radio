import { useEffect, useState } from "react";

/**
 * A house promo's QR code on the TV (handoff_house_promos.md §5.4), made in
 * the browser from the promo's short link, never a hand-made image. The
 * short link counts the scan (?s=tv) and redirects. qrcode is loaded only
 * when a promo is on air, so it stays out of the main bundle.
 */
export function PromoQr({ url, size = 280 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSvg(null);
    import("qrcode")
      .then((m) => (m.default ?? m).toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }))
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [url]);
  if (!svg) return null;
  return (
    <div className="tv-qr tv-promo-qr">
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="QR code for the link" width={size} height={size} style={{ width: size, height: size }} />
    </div>
  );
}
