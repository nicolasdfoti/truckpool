-- Add platformFeePercent to Trip
ALTER TABLE "Trip" ADD COLUMN "platformFeePercent" INTEGER NOT NULL DEFAULT 10;

-- Add mpUserId and mpAccessToken to User
ALTER TABLE "User" ADD COLUMN "mpUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "mpAccessToken" TEXT;

-- Add platformFeeAmount and carrierAmount to Payment
ALTER TABLE "Payment" ADD COLUMN "platformFeeAmount" DECIMAL(12,2);
ALTER TABLE "Payment" ADD COLUMN "carrierAmount" DECIMAL(12,2);