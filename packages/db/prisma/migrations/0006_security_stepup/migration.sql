CREATE TYPE "MfaState" AS ENUM ('PENDING','ACTIVE','REVOKED');
CREATE TABLE "UserMfa" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "secretEnvelope" BYTEA NOT NULL,
  "state" "MfaState" NOT NULL DEFAULT 'PENDING',
  "digits" INTEGER NOT NULL DEFAULT 6,
  "period" INTEGER NOT NULL DEFAULT 30,
  "lastUsedCounter" BIGINT NOT NULL DEFAULT -1,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserMfa_digits_check" CHECK ("digits" IN (6,8)),
  CONSTRAINT "UserMfa_period_check" CHECK ("period" BETWEEN 15 AND 120)
);
CREATE UNIQUE INDEX "UserMfa_userId_key" ON "UserMfa"("userId");
CREATE TABLE "RecoveryCode" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId","codeHash");
ALTER TABLE "Session" ADD COLUMN "deviceLabel" VARCHAR(120);
ALTER TABLE "Session" ADD COLUMN "ipHash" VARCHAR(64);
ALTER TABLE "Session" ADD COLUMN "userAgentHash" VARCHAR(64);
ALTER TABLE "Session" ADD COLUMN "stepUpExpiresAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "revokedReason" VARCHAR(120);
ALTER TABLE "UserMfa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserMfa" FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_self_or_super ON "UserMfa" FOR SELECT USING ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY mfa_insert_self_or_super ON "UserMfa" FOR INSERT WITH CHECK ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY mfa_update_self_or_super ON "UserMfa" FOR UPDATE USING ("userId" = gs_current_user_id() OR gs_is_super()) WITH CHECK ("userId" = gs_current_user_id() OR gs_is_super());
ALTER TABLE "RecoveryCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecoveryCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_self_or_super ON "RecoveryCode" FOR SELECT USING ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY recovery_insert_self_or_super ON "RecoveryCode" FOR INSERT WITH CHECK ("userId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY recovery_update_self_or_super ON "RecoveryCode" FOR UPDATE USING ("userId" = gs_current_user_id() OR gs_is_super()) WITH CHECK ("userId" = gs_current_user_id() OR gs_is_super());
