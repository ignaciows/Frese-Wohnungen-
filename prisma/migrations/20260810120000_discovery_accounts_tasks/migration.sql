-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('PORTAL', 'MAILBOX');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('CHECK_REPLY', 'REVIEW_LISTING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- DropForeignKey
ALTER TABLE "ContactMessage" DROP CONSTRAINT "ContactMessage_recordedById_fkey";

-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "outboundMessageId" TEXT,
ADD COLUMN     "sentToAddress" TEXT,
ADD COLUMN     "threadToken" TEXT;

-- AlterTable
ALTER TABLE "ContactMessage" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT,
ALTER COLUMN "recordedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactFormUrl" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastListedAt" TIMESTAMP(3),
ADD COLUMN     "missedSweeps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "discoveryAdapter" TEXT,
ADD COLUMN     "discoveryConfig" JSONB,
ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discoveryNote" TEXT,
ADD COLUMN     "discoveryStatus" TEXT,
ADD COLUMN     "lastDiscoveredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "candidateCaseId" TEXT,
    "query" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "retired" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL DEFAULT 'PORTAL',
    "sourceId" TEXT,
    "siteKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "loginName" TEXT,
    "secretEnc" TEXT,
    "secondarySecretEnc" TEXT,
    "meta" JSONB,
    "replyToAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "statusNote" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "listingId" TEXT,
    "contactAttemptId" TEXT,
    "kind" "TaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "url" TEXT,
    "candidateCaseId" TEXT,
    "listingId" TEXT,
    "contactAttemptId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_sourceId_startedAt_idx" ON "DiscoveryRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "DiscoveryRun_startedAt_idx" ON "DiscoveryRun"("startedAt");

-- CreateIndex
CREATE INDEX "PortalAccount_kind_active_idx" ON "PortalAccount"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_siteKey_label_key" ON "PortalAccount"("siteKey", "label");

-- CreateIndex
CREATE INDEX "FollowUpTask_state_dueAt_idx" ON "FollowUpTask"("state", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_candidateCaseId_state_idx" ON "FollowUpTask"("candidateCaseId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpTask_contactAttemptId_kind_key" ON "FollowUpTask"("contactAttemptId", "kind");

-- CreateIndex
CREATE INDEX "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_threadToken_key" ON "ContactAttempt"("threadToken");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMessage_externalId_key" ON "ContactMessage"("externalId");

-- CreateIndex
CREATE INDEX "ContactMessage_direction_readAt_idx" ON "ContactMessage"("direction", "readAt");

-- CreateIndex
CREATE INDEX "Listing_expired_lastListedAt_idx" ON "Listing"("expired", "lastListedAt");

-- CreateIndex
CREATE INDEX "Source_discoveryEnabled_idx" ON "Source"("discoveryEnabled");

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccount" ADD CONSTRAINT "PortalAccount_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalAccount" ADD CONSTRAINT "PortalAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_contactAttemptId_fkey" FOREIGN KEY ("contactAttemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_contactAttemptId_fkey" FOREIGN KEY ("contactAttemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

