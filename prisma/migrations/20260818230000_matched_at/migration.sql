-- `computedAt` heißt jetzt `matchedAt` — und wird nicht mehr neu gestempelt.
--
-- Das Feld sollte beantworten, wann für einen Fall zuletzt etwas
-- Anschreibbares dazukam. Es wurde aber bei jeder Neuberechnung überschrieben,
-- also nach jeder Profiländerung für alle Treffer auf einmal. Damit sah jeder
-- Fall taufrisch aus und die Warnung „steht seit Tagen still" konnte gar nicht
-- auslösen. Wann zuletzt gerechnet wurde, steht ohnehin in `updatedAt`.
--
-- Bewusst in einem DO-Block: ein RENAME ist nicht wiederholbar, und der
-- Start-Skript darf eine hängengebliebene Migration noch einmal fahren.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CandidateListingMatch' AND column_name = 'computedAt'
  ) THEN
    ALTER TABLE "CandidateListingMatch" RENAME COLUMN "computedAt" TO "matchedAt";
  END IF;
END $$;
