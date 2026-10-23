import "./PlaceLine.css";

export interface SongPlace {
  city: string;
  country: string | null;
}

/** The city a song on air is about (migrations/0029), when it has one. */
export const placeOf = (item: any): SongPlace | null => (item?.item_type === "song" && item?.place?.city ? item.place : null);

export const placeText = (p: SongPlace) => (p.country ? `${p.city}, ${p.country}` : p.city);

/** "Shanghai, China" under the title: the place is text, the pin decoration. A span, so it fits inside the mini player's button. */
export function PlaceLine({ item, className = "" }: { item: any; className?: string }) {
  const place = placeOf(item);
  if (!place) return null;
  return (
    <span className={`place-line ${className}`}>
      <svg className="place-line-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
        />
      </svg>
      <span>{placeText(place)}</span>
    </span>
  );
}
