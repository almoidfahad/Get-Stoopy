-- PostGIS must exist before geometry columns are created.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssuranceLevel" AS ENUM ('PASSWORD', 'MFA', 'STEP_UP');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GeographyType" AS ENUM ('COUNTRY', 'REGION', 'DISTRICT', 'CITY', 'ZONE', 'NEIGHBORHOOD');

-- CreateEnum
CREATE TYPE "AreaStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'PROVIDER', 'AI_AGENT');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "emailNormalized" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneE164" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorizationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminScope" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "geographyType" "GeographyType" NOT NULL,
    "countryId" UUID,
    "regionId" UUID,
    "districtId" UUID,
    "cityId" UUID,
    "serviceZoneId" UUID,
    "neighborhoodId" UUID,
    "grantedBy" UUID NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "assuranceLevel" "AssuranceLevel" NOT NULL DEFAULT 'PASSWORD',
    "state" "SessionState" NOT NULL DEFAULT 'ACTIVE',
    "encryptedTokenEnvelope" BYTEA,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "authVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" UUID NOT NULL,
    "iso2" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "callingCode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" UUID NOT NULL,
    "regionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "cityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Neighborhood" (
    "id" UUID NOT NULL,
    "serviceZoneId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoundaryVersion" (
    "id" UUID NOT NULL,
    "ownerType" "GeographyType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "boundary" geometry(MultiPolygon,4326) NOT NULL,
    "source" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "approvedBy" UUID,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoundaryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL,
    "sessionId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" UUID,
    "scopeSnapshot" JSONB NOT NULL,
    "beforeRedacted" JSONB,
    "afterRedacted" JSONB,
    "reason" TEXT,
    "requestId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxReceipt" (
    "consumer" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxReceipt_pkey" PRIMARY KEY ("consumer","eventKey")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseHash" TEXT,
    "resourceReference" TEXT,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "countryId" UUID,
    "environment" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutRule" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" UUID NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_issuer_subject_key" ON "UserIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_userId_issuer_key" ON "UserIdentity"("userId", "issuer");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "AdminScope_userId_revokedAt_idx" ON "AdminScope"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_state_idx" ON "Session"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Country_iso2_key" ON "Country"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "Region_countryId_code_key" ON "Region"("countryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "District_regionId_code_key" ON "District"("regionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "City_districtId_code_key" ON "City"("districtId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceZone_cityId_code_key" ON "ServiceZone"("cityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Neighborhood_serviceZoneId_code_key" ON "Neighborhood"("serviceZoneId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BoundaryVersion_ownerType_ownerId_version_key" ON "BoundaryVersion"("ownerType", "ownerId", "version");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_occurredAt_idx" ON "AuditLog"("resourceType", "resourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_occurredAt_idx" ON "AuditLog"("actorId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_occurredAt_idx" ON "OutboxEvent"("publishedAt", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorId_route_key_key" ON "IdempotencyRecord"("actorId", "route", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_countryId_environment_key" ON "FeatureFlag"("key", "countryId", "environment");

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminScope" ADD CONSTRAINT "AdminScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceZone" ADD CONSTRAINT "ServiceZone_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Neighborhood" ADD CONSTRAINT "Neighborhood_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- PostGIS and defense-in-depth RLS. Runtime role must not own tables or have BYPASSRLS.
CREATE INDEX IF NOT EXISTS boundary_version_gist ON "BoundaryVersion" USING GIST (boundary);
ALTER TABLE "BoundaryVersion" ADD CONSTRAINT boundary_valid CHECK (ST_IsValid(boundary));

CREATE OR REPLACE FUNCTION gs_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION gs_authorization_version() RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.auth_version', true), '')::int, -1)
$$;
CREATE OR REPLACE FUNCTION gs_is_super() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.is_super', true) = 'true'
$$;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminScope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_self_or_super ON "User" USING (gs_is_super() OR id = gs_current_user_id());
CREATE POLICY session_self_or_super ON "Session" USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY scope_self_or_super ON "AdminScope" USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY audit_super_only ON "AuditLog" FOR SELECT USING (gs_is_super());
CREATE POLICY idempotency_self_or_super ON "IdempotencyRecord" USING (gs_is_super() OR "actorId" = gs_current_user_id());

-- Audit and outbox are append-only for runtime; corrections use new records.
CREATE OR REPLACE FUNCTION gs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_record';
END;
$$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION gs_append_only();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION gs_append_only();

-- Scope must reference exactly one ancestry-consistent level. Application validates full ancestry in transaction.
ALTER TABLE "AdminScope" ADD CONSTRAINT admin_scope_one_level CHECK (
  ("countryId" IS NOT NULL)::int + ("regionId" IS NOT NULL)::int + ("districtId" IS NOT NULL)::int +
  ("cityId" IS NOT NULL)::int + ("serviceZoneId" IS NOT NULL)::int + ("neighborhoodId" IS NOT NULL)::int = 1
);

ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AdminScope" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_authenticated ON "AuditLog" FOR INSERT WITH CHECK (gs_is_super() OR gs_current_user_id() IS NOT NULL);
CREATE POLICY user_update_self_or_super ON "User" FOR UPDATE USING (gs_is_super() OR id = gs_current_user_id()) WITH CHECK (gs_is_super() OR id = gs_current_user_id());
CREATE POLICY session_insert_self_or_super ON "Session" FOR INSERT WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY session_update_self_or_super ON "Session" FOR UPDATE USING (gs_is_super() OR "userId" = gs_current_user_id()) WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY idempotency_insert_self_or_super ON "IdempotencyRecord" FOR INSERT WITH CHECK (gs_is_super() OR "actorId" = gs_current_user_id());
CREATE POLICY idempotency_update_self_or_super ON "IdempotencyRecord" FOR UPDATE USING (gs_is_super() OR "actorId" = gs_current_user_id()) WITH CHECK (gs_is_super() OR "actorId" = gs_current_user_id());
