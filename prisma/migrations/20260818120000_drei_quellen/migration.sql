-- Nur noch drei Quellen: Kleinanzeigen, ImmoScout24, Immowelt.
--
-- Der Katalog hatte rund fünfzig Einträge. Gebracht haben davon drei etwas;
-- der Rest hat pro Suchlauf Anfragen verbraucht und nichts geliefert. Diese
-- Migration räumt entsprechend auf und wirft die Felder weg, die nur wegen
-- der langen Liste existierten (Kategorie, Abdeckung, Aliasse, Familien,
-- Terms-Review-Status).

-- 1) Neue Spalte: wie eine Quelle überhaupt zu uns kommt.
ALTER TABLE "Source" ADD COLUMN "route" TEXT NOT NULL DEFAULT 'DISCOVERY';
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

-- 3) Was nie eine Anzeige geliefert hat, kann ganz weg.
DELETE FROM "Source"
 WHERE "key" NOT IN ('kleinanzeigen', 'immoscout24', 'immowelt')
   AND NOT EXISTS (SELECT 1 FROM "Listing" WHERE "Listing"."sourceId" = "Source"."id");

-- 4) Felder und Tabellen, die es ohne die lange Liste nicht mehr braucht.
ALTER TABLE "Source" DROP CONSTRAINT "Source_familyId_fkey";
ALTER TABLE "SourceAlias" DROP CONSTRAINT "SourceAlias_sourceId_fkey";
ALTER TABLE "SourceCoverage" DROP CONSTRAINT "SourceCoverage_sourceId_fkey";

ALTER TABLE "Source" DROP COLUMN "category",
DROP COLUMN "connectorStatus",
DROP COLUMN "familyId",
DROP COLUMN "housingTypes",
DROP COLUMN "integrationMode",
DROP COLUMN "manualImportInstructions",
DROP COLUMN "requiresAuth",
DROP COLUMN "searchUrlTemplate",
DROP COLUMN "searchUrlValidated",
DROP COLUMN "temporaryOnly",
DROP COLUMN "termsReviewStatus",
DROP COLUMN "termsReviewUrl",
DROP COLUMN "termsReviewedAt";

DROP TABLE "SourceAlias";
DROP TABLE "SourceCoverage";
DROP TABLE "SourceFamily";

DROP TYPE "ConnectorStatus";
DROP TYPE "CoverageKind";
DROP TYPE "IntegrationMode";
DROP TYPE "SourceCategory";
DROP TYPE "TermsReviewStatus";

-- 5) Der Suchlauf plant nur noch drei bundesweite Portale. Damit gibt es weder
--    eine generierte Such-URL (das Template ist weg) noch einen Grund, warum
--    eine Quelle im Plan ist — es sind immer alle drei.
ALTER TABLE "SourceCheck" DROP COLUMN "generatedUrl", DROP COLUMN "inclusionReason";
