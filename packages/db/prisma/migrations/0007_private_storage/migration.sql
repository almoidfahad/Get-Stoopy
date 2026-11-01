CREATE TYPE "StorageObjectState" AS ENUM ('PENDING_UPLOAD','UPLOADED','QUARANTINED','DELETED');
CREATE TABLE "StorageObject" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" UUID NOT NULL,
  "purpose" VARCHAR(64) NOT NULL,
  "objectKey" VARCHAR(512) NOT NULL,
  "contentType" VARCHAR(120) NOT NULL,
  "sizeBytes" BIGINT,
  "sha256" VARCHAR(64),
  "state" "StorageObjectState" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "encryptionKeyId" VARCHAR(120) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageObject_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StorageObject_objectKey_key" ON "StorageObject"("objectKey");
CREATE INDEX "StorageObject_owner_idx" ON "StorageObject"("ownerUserId","purpose","state");
ALTER TABLE "StorageObject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StorageObject" FORCE ROW LEVEL SECURITY;
CREATE POLICY storage_self_or_super ON "StorageObject" FOR SELECT USING ("ownerUserId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY storage_insert_self_or_super ON "StorageObject" FOR INSERT WITH CHECK ("ownerUserId" = gs_current_user_id() OR gs_is_super());
CREATE POLICY storage_update_self_or_super ON "StorageObject" FOR UPDATE USING ("ownerUserId" = gs_current_user_id() OR gs_is_super()) WITH CHECK ("ownerUserId" = gs_current_user_id() OR gs_is_super());
