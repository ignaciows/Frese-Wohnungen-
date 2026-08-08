-- CreateEnum
CREATE TYPE "ResponseOutcome" AS ENUM ('AWAITING', 'POSITIVE', 'NEGATIVE', 'NEEDS_INFO');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN     "outcome" "ResponseOutcome" NOT NULL DEFAULT 'AWAITING',
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "outcomeNote" TEXT;

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "contactAttemptId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_contactAttemptId_occurredAt_idx" ON "ContactMessage"("contactAttemptId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_outcomeById_fkey" FOREIGN KEY ("outcomeById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_contactAttemptId_fkey" FOREIGN KEY ("contactAttemptId") REFERENCES "ContactAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessage" ADD CONSTRAINT "ContactMessage_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
