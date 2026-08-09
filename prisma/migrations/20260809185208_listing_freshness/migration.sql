-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
