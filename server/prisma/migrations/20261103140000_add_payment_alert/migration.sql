-- CreateTable
CREATE TABLE "PaymentAlert" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAlert_pkey" PRIMARY KEY ("key")
);
