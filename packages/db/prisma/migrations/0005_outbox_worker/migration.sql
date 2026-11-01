ALTER TABLE "OutboxEvent" ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OutboxEvent" ADD COLUMN "lastError" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "failedAt" TIMESTAMP(3);
CREATE INDEX "OutboxEvent_pending_idx" ON "OutboxEvent"("availableAt", "occurredAt") WHERE "publishedAt" IS NULL AND "failedAt" IS NULL;
