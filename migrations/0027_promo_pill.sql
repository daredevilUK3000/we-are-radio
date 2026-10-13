-- The label a house promo carries on the players, the TV and the lock screen
-- (13 Oct 2026). Kizzi's books keep "We Are Radio recommends"; an ad for one
-- of his own businesses (InvoiceHawk) is labelled "Advertisement", so a
-- listener can always tell an ad from a recommendation (CAP code: ads must be
-- obviously identifiable). Additive only; every existing promo keeps its label.
--
--   pill   'recommends' = "We Are Radio recommends", 'advert' = "Advertisement"

ALTER TABLE promos ADD COLUMN pill TEXT NOT NULL DEFAULT 'recommends' CHECK (pill IN ('recommends','advert'));
