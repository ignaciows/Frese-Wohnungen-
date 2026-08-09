-- CreateTable
CREATE TABLE "WeeklySummary" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "anfragenSent" INTEGER NOT NULL DEFAULT 0,
    "positiveReplies" INTEGER NOT NULL DEFAULT 0,
    "negativeReplies" INTEGER NOT NULL DEFAULT 0,
    "awaitingReplies" INTEGER NOT NULL DEFAULT 0,
    "listingsImported" INTEGER NOT NULL DEFAULT 0,
    "sourcesChecked" INTEGER NOT NULL DEFAULT 0,
    "appointmentsHeld" INTEGER NOT NULL DEFAULT 0,
    "appointmentsAhead" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklySummary_weekStart_idx" ON "WeeklySummary"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySummary_candidateCaseId_weekStart_key" ON "WeeklySummary"("candidateCaseId", "weekStart");

-- AddForeignKey
ALTER TABLE "WeeklySummary" ADD CONSTRAINT "WeeklySummary_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
