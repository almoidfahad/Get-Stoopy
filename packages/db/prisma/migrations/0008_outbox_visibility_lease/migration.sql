-- Additive outbox visibility lease + fencing token.
-- Safe for existing rows: NULL means "not currently leased".
ALTER TABLE "OutboxEvent" ADD COLUMN "leaseToken" UUID;
ALTER TABLE "OutboxEvent" ADD COLUMN "leaseUntil" TIMESTAMP(3);

ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_lease_pair_check"
  CHECK (
    ("leaseToken" IS NULL AND "leaseUntil" IS NULL)
    OR ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
  );

CREATE INDEX "OutboxEvent_lease_idx"
  ON "OutboxEvent"("leaseUntil")
  WHERE "publishedAt" IS NULL AND "failedAt" IS NULL AND "leaseUntil" IS NOT NULL;
