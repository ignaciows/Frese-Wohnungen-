-- Der Arbeitgeber gehört zur Suche.
--
-- Die Wohnung wird um den Arbeitsplatz herum gesucht; der Name der Klinik oder
-- des Trägers macht eine Adresse einordenbar, ohne sie nachzuschlagen.
ALTER TABLE IF EXISTS "SearchProfile" ADD COLUMN IF NOT EXISTS "employer" TEXT;
