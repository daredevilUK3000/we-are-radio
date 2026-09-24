/** The red band of countries scrolling under the hero. Rendered twice and moved -50% for a seamless loop. */
const DESKTOP_LINE =
  "Open to Independent Creators in ★ Brazil ★ Japan ★ Nigeria ★ France ★ India ★ Mexico ★ South Korea ★ Ghana ★ Canada ★ The Philippines ★ Kenya ★ The UK ★ Every country on Earth ★ ";
const PHONE_LINE =
  "Open in every country ★ Brazil ★ Japan ★ Nigeria ★ France ★ India ★ Mexico ★ South Korea ★ Ghana ★ Canada ★ Kenya ★ The UK ★ ";

export function CountryMarquee() {
  return (
    <div className="t3p-marquee" role="img" aria-label="Open to Independent Creators in every country">
      <div className="t3p-marquee-track" aria-hidden="true">
        {[0, 1].map((i) => (
          <span key={i} className="t3p-marquee-text">
            <span className="t3p-desktop-only">{DESKTOP_LINE}</span>
            <span className="t3p-mobile-only">{PHONE_LINE}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
