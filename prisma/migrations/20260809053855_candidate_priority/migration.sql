-- AlterTable
ALTER TABLE "CandidateCase" ADD COLUMN     "contractSignedAt" TIMESTAMP(3),
ADD COLUMN     "housingSecuredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketRegion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seededDifficulty" INTEGER NOT NULL DEFAULT 50,
    "seedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketRegion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketRegion_key_key" ON "MarketRegion"("key");
