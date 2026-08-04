-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'COLLEAGUE');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FurnishedPreference" AS ENUM ('REQUIRED', 'PREFERRED', 'EITHER');

-- CreateEnum
CREATE TYPE "WbsStatus" AS ENUM ('AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CommuteMode" AS ENUM ('CAR', 'PUBLIC_TRANSPORT', 'BIKE', 'WALK');

-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('OFFICIAL_API', 'EMAIL_ALERT', 'SEARCH_LINK', 'MANUAL_IMPORT', 'BROWSER_ONLY', 'REGIONAL_DIRECTORY', 'CUSTOM_SOURCE');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('NONE', 'PLANNED', 'BLOCKED_BY_PERMISSION', 'AVAILABLE', 'UNHEALTHY');

-- CreateEnum
CREATE TYPE "TermsReviewStatus" AS ENUM ('NOT_REVIEWED', 'REVIEW_PENDING', 'MANUAL_ONLY', 'APPROVED_FOR_AUTOMATION');

-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('MARKETPLACE', 'GENERAL_PORTAL', 'FURNISHED', 'INSTITUTIONAL_LANDLORD', 'COOPERATIVE', 'MUNICIPAL', 'TEMPORARY', 'SOCIAL_LOCAL', 'DIRECTORY');

-- CreateEnum
CREATE TYPE "CoverageKind" AS ENUM ('NATIONWIDE', 'STATE', 'CITY', 'POSTAL_PREFIX');

-- CreateEnum
CREATE TYPE "MappingQuality" AS ENUM ('EXACT', 'APPROXIMATE', 'MANUAL', 'UNSUPPORTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SearchRunStatus" AS ENUM ('OPEN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SourceCheckStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CHECKED_NO_RESULTS', 'CHECKED_RESULTS_IMPORTED', 'UNAVAILABLE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Furnishing" AS ENUM ('FULLY_FURNISHED', 'FURNISHED', 'PARTIALLY_FURNISHED', 'FURNITURE_TAKEOVER', 'UNFURNISHED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'WG_ROOM', 'HOUSE', 'FOR_SALE', 'EXCHANGE', 'TEMPORARY', 'COMMERCIAL', 'PARKING', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TriState" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('STRUCTURED_FIELD', 'DESCRIPTION', 'TITLE', 'DERIVED', 'MANUAL');

-- CreateEnum
CREATE TYPE "Compatibility" AS ENUM ('COMPATIBLE', 'NEAR_MATCH', 'INCOMPATIBLE', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NEW', 'FAVORITE', 'IN_PROGRESS', 'CONTACTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('SUSPECTED', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'COLLEAGUE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateCase" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "notes" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationMessage" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchProfile" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "workplaceAddress" TEXT NOT NULL,
    "workplaceCity" TEXT,
    "workplacePostalCode" TEXT,
    "workplaceLat" DOUBLE PRECISION,
    "workplaceLon" DOUBLE PRECISION,
    "geocodeStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "maxWarmmieteCents" INTEGER NOT NULL DEFAULT 90000,
    "moveInDate" TIMESTAMP(3),
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "minRooms" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "preferredRooms" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "furnished" "FurnishedPreference" NOT NULL DEFAULT 'PREFERRED',
    "maxCommuteMinutes" INTEGER DEFAULT 35,
    "radiusKm" INTEGER,
    "commuteMode" "CommuteMode" NOT NULL DEFAULT 'CAR',
    "wbsStatus" "WbsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "pets" TEXT,
    "temporaryMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFamily" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "SourceFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "familyId" TEXT,
    "category" "SourceCategory" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "integrationMode" "IntegrationMode" NOT NULL,
    "requiresAuth" BOOLEAN NOT NULL DEFAULT false,
    "connectorStatus" "ConnectorStatus" NOT NULL DEFAULT 'NONE',
    "termsReviewStatus" "TermsReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "termsReviewUrl" TEXT,
    "termsReviewedAt" TIMESTAMP(3),
    "searchUrlTemplate" TEXT,
    "searchUrlValidated" BOOLEAN NOT NULL DEFAULT false,
    "manualRecipe" TEXT,
    "manualImportInstructions" TEXT,
    "notes" TEXT,
    "housingTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "temporaryOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAlias" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "SourceAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCoverage" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "CoverageKind" NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SourceCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFilterMapping" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalFilter" TEXT NOT NULL,
    "quality" "MappingQuality" NOT NULL DEFAULT 'UNKNOWN',
    "portalLabel" TEXT,
    "note" TEXT,

    CONSTRAINT "SourceFilterMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "SearchRunStatus" NOT NULL DEFAULT 'OPEN',
    "profileSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCheck" (
    "id" TEXT NOT NULL,
    "searchRunId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "SourceCheckStatus" NOT NULL DEFAULT 'PENDING',
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "claimedById" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "unavailableReason" TEXT,
    "note" TEXT,
    "mappingSnapshot" JSONB NOT NULL,
    "recipeSnapshot" JSONB NOT NULL,
    "generatedUrl" TEXT,
    "inclusionReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "rawUrl" TEXT NOT NULL,
    "sourceListingId" TEXT,
    "title" TEXT NOT NULL,
    "descriptionRaw" TEXT NOT NULL DEFAULT '',
    "locationRaw" TEXT NOT NULL DEFAULT '',
    "locationCity" TEXT,
    "locationPostal" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "notes" TEXT,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'UNKNOWN',
    "furnishing" "Furnishing" NOT NULL DEFAULT 'UNKNOWN',
    "warmMieteCents" INTEGER,
    "kaltMieteCents" INTEGER,
    "nebenkostenCents" INTEGER,
    "heizkostenCents" INTEGER,
    "otherMonthlyCents" INTEGER,
    "depositCents" INTEGER,
    "abloeseCents" INTEGER,
    "provisionNote" TEXT,
    "monthlyTotalComplete" BOOLEAN NOT NULL DEFAULT false,
    "effectiveMonthlyCents" INTEGER,
    "rooms" DOUBLE PRECISION,
    "livingSpaceSqm" DOUBLE PRECISION,
    "availableFrom" TIMESTAMP(3),
    "availableNow" BOOLEAN NOT NULL DEFAULT false,
    "wbsRequired" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "exchangeRequired" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "petsAllowed" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "fittedKitchen" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "anmeldungPossible" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "fixedTerm" "TriState" NOT NULL DEFAULT 'UNKNOWN',
    "minDurationMonths" INTEGER,
    "maxDurationMonths" INTEGER,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractorVersion" TEXT NOT NULL DEFAULT '',
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "importedById" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingFact" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "origin" "FactSource" NOT NULL,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "extractorVersion" TEXT NOT NULL DEFAULT '',
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateListingMatch" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "compatibility" "Compatibility" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "blockers" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'NEW',
    "rejectedReason" TEXT,
    "rankVersion" TEXT NOT NULL DEFAULT '',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateListingMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingClaim" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "ListingClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageSnapshot" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PORTAL_FORM',
    "note" TEXT,
    "overrideReason" TEXT,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemTransfer" (
    "id" TEXT NOT NULL,
    "contactAttemptId" TEXT NOT NULL,
    "objectLabel" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3),
    "registeredById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateGroup" (
    "id" TEXT NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'SUSPECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "DuplicateMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "candidateCaseId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateCase_reference_key" ON "CandidateCase"("reference");

-- CreateIndex
CREATE INDEX "CandidateCase_status_idx" ON "CandidateCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationMessage_candidateCaseId_key" ON "ApplicationMessage"("candidateCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchProfile_candidateCaseId_key" ON "SearchProfile"("candidateCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFamily_key_key" ON "SourceFamily"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "Source_active_priority_idx" ON "Source"("active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAlias_sourceId_name_key" ON "SourceAlias"("sourceId", "name");

-- CreateIndex
CREATE INDEX "SourceCoverage_kind_value_idx" ON "SourceCoverage"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCoverage_sourceId_kind_value_key" ON "SourceCoverage"("sourceId", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFilterMapping_sourceId_canonicalFilter_key" ON "SourceFilterMapping"("sourceId", "canonicalFilter");

-- CreateIndex
CREATE INDEX "SearchRun_candidateCaseId_createdAt_idx" ON "SearchRun"("candidateCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceCheck_searchRunId_status_idx" ON "SourceCheck"("searchRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCheck_searchRunId_sourceId_key" ON "SourceCheck"("searchRunId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_canonicalUrl_key" ON "Listing"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Listing_sourceId_idx" ON "Listing"("sourceId");

-- CreateIndex
CREATE INDEX "Listing_sourceListingId_idx" ON "Listing"("sourceListingId");

-- CreateIndex
CREATE INDEX "ListingFact_listingId_key_idx" ON "ListingFact"("listingId", "key");

-- CreateIndex
CREATE INDEX "CandidateListingMatch_candidateCaseId_status_idx" ON "CandidateListingMatch"("candidateCaseId", "status");

-- CreateIndex
CREATE INDEX "CandidateListingMatch_candidateCaseId_compatibility_score_idx" ON "CandidateListingMatch"("candidateCaseId", "compatibility", "score");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateListingMatch_candidateCaseId_listingId_key" ON "CandidateListingMatch"("candidateCaseId", "listingId");

-- CreateIndex
CREATE INDEX "ListingClaim_listingId_expiresAt_idx" ON "ListingClaim"("listingId", "expiresAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_listingId_idx" ON "ContactAttempt"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_listingId_candidateCaseId_key" ON "ContactAttempt"("listingId", "candidateCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemTransfer_contactAttemptId_key" ON "SystemTransfer"("contactAttemptId");

-- CreateIndex
CREATE INDEX "DuplicateMember_listingId_idx" ON "DuplicateMember"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateMember_groupId_listingId_key" ON "DuplicateMember"("groupId", "listingId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_candidateCaseId_createdAt_idx" ON "AuditEvent"("candidateCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "CandidateCase" ADD CONSTRAINT "CandidateCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMessage" ADD CONSTRAINT "ApplicationMessage_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMessage" ADD CONSTRAINT "ApplicationMessage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchProfile" ADD CONSTRAINT "SearchProfile_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "SourceFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAlias" ADD CONSTRAINT "SourceAlias_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCoverage" ADD CONSTRAINT "SourceCoverage_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFilterMapping" ADD CONSTRAINT "SourceFilterMapping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCheck" ADD CONSTRAINT "SourceCheck_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCheck" ADD CONSTRAINT "SourceCheck_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCheck" ADD CONSTRAINT "SourceCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCheck" ADD CONSTRAINT "SourceCheck_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingFact" ADD CONSTRAINT "ListingFact_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingFact" ADD CONSTRAINT "ListingFact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListingMatch" ADD CONSTRAINT "CandidateListingMatch_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateListingMatch" ADD CONSTRAINT "CandidateListingMatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingClaim" ADD CONSTRAINT "ListingClaim_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingClaim" ADD CONSTRAINT "ListingClaim_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingClaim" ADD CONSTRAINT "ListingClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTransfer" ADD CONSTRAINT "SystemTransfer_contactAttemptId_fkey" FOREIGN KEY ("contactAttemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemTransfer" ADD CONSTRAINT "SystemTransfer_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateMember" ADD CONSTRAINT "DuplicateMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DuplicateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateMember" ADD CONSTRAINT "DuplicateMember_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
