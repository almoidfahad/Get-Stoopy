-- Durable terminal inbox failures. Additive; no existing rows are rewritten.
CREATE TABLE "InboxDeadLetter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "consumer" VARCHAR(128) NOT NULL,
  "eventKey" VARCHAR(128),
  "eventType" VARCHAR(128),
  "payloadHash" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "errorCode" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL,
  "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboxDeadLetter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboxDeadLetter_attempts_check" CHECK ("attempts" >= 1),
  CONSTRAINT "InboxDeadLetter_consumer_payloadHash_key" UNIQUE ("consumer", "payloadHash")
);

CREATE INDEX "InboxDeadLetter_consumer_lastFailedAt_idx"
  ON "InboxDeadLetter"("consumer", "lastFailedAt");

COMMENT ON TABLE "InboxDeadLetter" IS 'Terminal inbox failures; operator replay/resolve API is a later slice. No DELETE grant is issued.';
