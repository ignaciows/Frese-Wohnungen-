-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('VIDEO_CALL', 'VIEWING', 'PHONE_CALL', 'HANDOVER', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'DONE_POSITIVE', 'DONE_NEGATIVE', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "CandidateCase" ADD COLUMN     "languages" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "openToSharing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "candidateCaseId" TEXT NOT NULL,
    "listingId" TEXT,
    "kind" "AppointmentKind" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER,
    "location" TEXT,
    "notes" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcomeNote" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedHousingSuggestion" (
    "id" TEXT NOT NULL,
    "caseAId" TEXT NOT NULL,
    "caseBId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "dismissReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedHousingSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_candidateCaseId_scheduledAt_idx" ON "Appointment"("candidateCaseId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Appointment_scheduledAt_status_idx" ON "Appointment"("scheduledAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SharedHousingSuggestion_caseAId_caseBId_key" ON "SharedHousingSuggestion"("caseAId", "caseBId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_candidateCaseId_fkey" FOREIGN KEY ("candidateCaseId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedHousingSuggestion" ADD CONSTRAINT "SharedHousingSuggestion_caseAId_fkey" FOREIGN KEY ("caseAId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedHousingSuggestion" ADD CONSTRAINT "SharedHousingSuggestion_caseBId_fkey" FOREIGN KEY ("caseBId") REFERENCES "CandidateCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedHousingSuggestion" ADD CONSTRAINT "SharedHousingSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
