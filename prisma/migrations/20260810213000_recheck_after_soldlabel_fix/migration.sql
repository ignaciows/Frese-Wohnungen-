-- Give back the ads a detector bug wrongly declared dead.
--
-- Every live Kleinanzeigen advert carries `data-soldlabel="Nicht mehr
-- verfügbar"` on its own headline — the label the page would show if the flat
-- were ever let. The liveness check matched its "gone" wording against raw
-- HTML, so that attribute read as the portal announcing a withdrawal, on every
-- advert from the source the pool mostly consists of. They were scored at 18 %
-- online, filtered out of the results, and in time retired outright.
--
-- The detector now reads only text a person would see. This puts the ads it
-- misjudged back into the normal check cycle rather than trusting the old
-- verdict: clearing the check result means the next sweep re-reads the page and
-- decides again. Ones that really are gone are retired again within a sweep or
-- two, which is the right way round — a wrongly hidden flat is never seen
-- again, while a wrongly shown one costs a click.
--
-- Deliberately narrow: only rows the system itself retired, and only where the
-- verdict came from the text check. A colleague's own decision to expire an ad
-- is left exactly as it is.

UPDATE "Listing"
SET "expired"          = false,
    "expiredAt"        = NULL,
    "expiredBySystem"  = false,
    "lastCheckStatus"  = NULL,
    "lastCheckReason"  = NULL,
    "lastCheckedAt"    = NULL,
    "onlineConfidence" = NULL,
    "goneStreak"       = 0
WHERE "expired" = true
  AND "expiredBySystem" = true
  AND "lastCheckStatus" = 'GONE';

-- The same misreading also sat on ads that were not yet retired, holding them
-- below the visibility threshold. Clear the verdict so they are re-read too.
UPDATE "Listing"
SET "lastCheckStatus"  = NULL,
    "lastCheckReason"  = NULL,
    "lastCheckedAt"    = NULL,
    "onlineConfidence" = NULL,
    "goneStreak"       = 0
WHERE "expired" = false
  AND "lastCheckStatus" = 'GONE';
