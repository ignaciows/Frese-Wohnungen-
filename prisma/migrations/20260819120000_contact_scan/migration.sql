-- Wann eine Anzeige zuletzt nach Kontaktdaten durchsucht wurde.
--
-- Die Telefonnummer wird beim Import aus dem Anzeigentext gelesen. Alles, was
-- vor dieser Funktion importiert wurde, hat deshalb keine — und weil eine
-- Anzeige ihre Detailseite nur einmal lesen lässt, wäre das für immer so
-- geblieben. Mit dieser Spalte lässt sich der Bestand einmal nachziehen, ohne
-- ihn bei jedem Durchlauf erneut zu durchsuchen.
ALTER TABLE IF EXISTS "Listing" ADD COLUMN IF NOT EXISTS "contactScannedAt" TIMESTAMP(3);
