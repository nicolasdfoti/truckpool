-- CreateEnum
CREATE TYPE "TripRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- Add isAvailableForRequests to User
ALTER TABLE "User" ADD COLUMN "isAvailableForRequests" BOOLEAN NOT NULL DEFAULT true;

-- Create TripRequest table
CREATE TABLE "TripRequest" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "desiredDate" TIMESTAMP(3) NOT NULL,
    "estimatedVolume" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" "TripRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultingTripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,

    CONSTRAINT "TripRequest_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "TripRequest_carrierId_status_idx" ON "TripRequest"("carrierId", "status");
CREATE INDEX "TripRequest_companyId_createdAt_idx" ON "TripRequest"("companyId", "createdAt");

-- Add foreign keys
ALTER TABLE "TripRequest" ADD CONSTRAINT "TripRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripRequest" ADD CONSTRAINT "TripRequest_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add new NotificationType values
ALTER TYPE "NotificationType" ADD VALUE 'TRIP_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'TRIP_REQUEST_RESPONSE';