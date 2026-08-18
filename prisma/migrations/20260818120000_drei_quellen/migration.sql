-- Nur noch drei Quellen: Kleinanzeigen, ImmoScout24, Immowelt.
--
-- Durchgehend `ALTER TABLE IF EXISTS` samt `IF EXISTS` / `IF NOT EXISTS` an
-- jeder Spalte und jedem Constraint — `DROP CONSTRAINT IF EXISTS` alleine
-- reicht nicht, Postgres verlangt trotzdem, dass die Tabelle existiert. diese Migration ist beim ersten
-- Produktiv-Deploy an einem Fremdschlüssel gescheitert, danach hat der
-- Start-Skript das Schema per `db push` nachgezogen. Damit stimmte das Schema,
-- aber die Migrationshistorie nicht mehr — und eine Migration, die sich nicht
-- wiederholen lässt, ist aus so einem Zustand nicht mehr herauszubekommen.
--
-- Der Katalog hatte rund fünfzig Einträge. Gebracht haben davon drei etwas;
-- der Rest hat pro Suchlauf Anfragen verbraucht und nichts geliefert. Diese
-- Migration räumt entsprechend auf und wirft die Felder weg, die nur wegen
-- der langen Liste existierten (Kategorie, Abdeckung, Aliasse, Familien,
-- Terms-Review-Status).

-- 1) Neue Spalte: wie eine Quelle überhaupt zu uns kommt.
ALTER TABLE IF EXISTS "Source" ADD COLUMN IF NOT EXISTS "route" TEXT NOT NULL DEFAULT 'DISCOVERY';
UPDATE "Source" SET "route" = 'EMAIL_ALERT' WHERE "key" IN ('immoscout24', 'immowelt');

-- 2) Alles, was nicht mehr im Katalog steht, wird stillgelegt: keine
--    Suchläufe mehr, nicht mehr in Listen sichtbar. Bewusst kein DELETE für
--    Quellen mit Anzeigen — an einer Anzeige kann eine laufende Konversation
--    hängen, und die überlebt die Quelle.
UPDATE "Source"
   SET "active" = false,
       "discoveryEnabled" = false,
       "discoveryStatus" = 'RETIRED',
       "discoveryNote" = 'Nicht mehr im Katalog — nur noch Kleinanzeigen, ImmoScout24 und Immowelt.'
 WHERE "key" NOT IN ('kleinanzeigen', 'immoscout24', 'immowelt');

-- 3) Was gar keine Spur hinterlassen hat, kann ganz weg.
--
--    Keine Anzeige UND keine Suchlauf-Aufgabe: beide Tabellen verweigern das
--    Löschen (ON DELETE RESTRICT), und beide zu Recht — an einer Anzeige kann
--    ein Gespräch hängen, und ein SourceCheck ist die Notiz, dass jemand diese
--    Quelle an einem Tag abgearbeitet hat. Nur auf die Anzeigen zu prüfen hat
--    genau diese Migration beim ersten Produktiv-Deploy scheitern lassen.
DELETE FROM "Source"
 WHERE "key" NOT IN ('kleinanzeigen', 'immoscout24', 'immowelt')
   AND NOT EXISTS (SELECT 1 FROM "Listing" WHERE "Listing"."sourceId" = "Source"."id")
   AND NOT EXISTS (SELECT 1 FROM "SourceCheck" WHERE "SourceCheck"."sourceId" = "Source"."id");

-- 4) Felder und Tabellen, die es ohne die lange Liste nicht mehr braucht.
ALTER TABLE IF EXISTS "Source" DROP CONSTRAINT IF EXISTS "Source_familyId_fkey";
ALTER TABLE IF EXISTS "SourceAlias" DROP CONSTRAINT IF EXISTS "SourceAlias_sourceId_fkey";
ALTER TABLE IF EXISTS "SourceCoverage" DROP CONSTRAINT IF EXISTS "SourceCoverage_sourceId_fkey";

ALTER TABLE IF EXISTS "Source" DROP COLUMN IF EXISTS "category",
DROP COLUMN IF EXISTS "connectorStatus",
DROP COLUMN IF EXISTS "familyId",
DROP COLUMN IF EXISTS "housingTypes",
DROP COLUMN IF EXISTS "integrationMode",
DROP COLUMN IF EXISTS "manualImportInstructions",
DROP COLUMN IF EXISTS "requiresAuth",
DROP COLUMN IF EXISTS "searchUrlTemplate",
DROP COLUMN IF EXISTS "searchUrlValidated",
DROP COLUMN IF EXISTS "temporaryOnly",
DROP COLUMN IF EXISTS "termsReviewStatus",
DROP COLUMN IF EXISTS "termsReviewUrl",
DROP COLUMN IF EXISTS "termsReviewedAt";

DROP TABLE IF EXISTS "SourceAlias";
DROP TABLE IF EXISTS "SourceCoverage";
DROP TABLE IF EXISTS "SourceFamily";

DROP TYPE IF EXISTS "ConnectorStatus";
DROP TYPE IF EXISTS "CoverageKind";
DROP TYPE IF EXISTS "IntegrationMode";
DROP TYPE IF EXISTS "SourceCategory";
DROP TYPE IF EXISTS "TermsReviewStatus";

-- 5) Der Suchlauf plant nur noch drei bundesweite Portale. Damit gibt es weder
--    eine generierte Such-URL (das Template ist weg) noch einen Grund, warum
--    eine Quelle im Plan ist — es sind immer alle drei.
ALTER TABLE IF EXISTS "SourceCheck" DROP COLUMN IF EXISTS "generatedUrl", DROP COLUMN IF EXISTS "inclusionReason";
