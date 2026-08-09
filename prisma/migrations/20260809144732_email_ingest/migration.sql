-- CreateTable
CREATE TABLE "EmailIngestLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "candidateCaseId" TEXT,
    "sourceKey" TEXT,
    "listingsCreated" INTEGER NOT NULL DEFAULT 0,
    "listingsSeen" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIngestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailIngestLog_messageId_key" ON "EmailIngestLog"("messageId");

-- CreateIndex
CREATE INDEX "EmailIngestLog_createdAt_idx" ON "EmailIngestLog"("createdAt");
