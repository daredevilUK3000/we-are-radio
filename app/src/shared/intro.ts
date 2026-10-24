// A song's spoken intro on air (migrations/0030, "before the song"). The
// server sends it as its own item - an ordinary link, so older players simply
// play it - with `intro_for`: the song it introduces. The players show that
// song (title, artist, artwork, place) with a small "Intro" label instead of
// a separate item. It is never a song itself: no likes, no Start over, and
// analytics count it as nothing (shared/analytics.ts counts songs only).

export interface IntroFor {
  track_id: string;
  title: string | null;
  artist?: string | null;
  album_title?: string | null;
  artwork_url?: string | null;
  place?: { city: string; country: string | null } | null;
}

export const introOf = (item: any): IntroFor | null => (item?.intro_for?.track_id ? (item.intro_for as IntroFor) : null);

/** The title to show for an item: the song an intro introduces, else the item's own label. */
export const shownTitle = (item: any): string | null => introOf(item)?.title ?? item?.label ?? null;

export const INTRO_LABEL = "Intro";
