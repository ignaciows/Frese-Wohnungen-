-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "expiredBySystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "goneStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastCheckReason" TEXT,
ADD COLUMN     "lastCheckStatus" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);
