-- Add notification, notification preference, and delivery attempt tables.
--
-- Notifications are user-scoped: a notification always belongs to one user,
-- and RLS enforces that users can only read/update their own rows.
-- Notification attempts are an append-only audit trail readable only by super.

-- Enums
CREATE TYPE "NotificationType" AS ENUM (
  'ORDER_STATUS',
  'DELIVERY_UPDATE',
  'PAYMENT_REMINDER',
  'KYC_UPDATE',
  'PROMOTIONAL',
  'SYSTEM_ALERT'
);

CREATE TYPE "NotificationChannel" AS ENUM (
  'EMAIL',
  'SMS',
  'PUSH',
  'IN_APP'
);

CREATE TYPE "NotificationStatus" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'READ'
);

-- Notification table
CREATE TABLE "Notification" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL REFERENCES "User"(id),
  "type"          "NotificationType" NOT NULL,
  "channel"       "NotificationChannel" NOT NULL,
  "status"        "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "subject"       VARCHAR(200) NOT NULL,
  "body"          TEXT NOT NULL,
  "templateId"    UUID,
  "commandKey"    VARCHAR(128) NOT NULL,
  "payloadHash"   VARCHAR(64) NOT NULL,
  "sentAt"        TIMESTAMPTZ,
  "readAt"        TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "notification_user_command_key_idx" ON "Notification"("userId", "commandKey");
CREATE INDEX "notification_user_status_created_idx" ON "Notification"("userId", "status", "createdAt");
CREATE INDEX "notification_user_channel_created_idx" ON "Notification"("userId", "channel", "createdAt");
CREATE INDEX "notification_status_created_idx" ON "Notification"("status", "createdAt");

COMMENT ON TABLE "Notification" IS 'User notifications; one row per delivered or attempted message.';
COMMENT ON COLUMN "Notification"."commandKey" IS 'Client-generated idempotency key; deduplicated per (userId, commandKey).';
COMMENT ON COLUMN "Notification"."payloadHash" IS 'SHA-256 of commandKey for replay detection.';
COMMENT ON COLUMN "Notification"."sentAt" IS 'When the delivery attempt succeeded; null until sent.';
COMMENT ON COLUMN "Notification"."readAt" IS 'When the user marked the notification as read; null if unread.';

-- Notification preferences
CREATE TABLE "NotificationPreference" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL REFERENCES "User"(id),
  "channel"   "NotificationChannel" NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "notification_preference_user_channel_idx" ON "NotificationPreference"("userId", "channel");
CREATE INDEX "notification_preference_user_idx" ON "NotificationPreference"("userId");

COMMENT ON TABLE "NotificationPreference" IS 'Per-user, per-channel delivery preference flags.';

-- Notification delivery attempts (append-only audit trail)
CREATE TABLE "NotificationAttempt" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" UUID NOT NULL REFERENCES "Notification"(id) ON DELETE CASCADE,
  "channel"        "NotificationChannel" NOT NULL,
  "status"         "NotificationStatus" NOT NULL,
  "errorCode"      VARCHAR(64),
  "errorMessage"   TEXT,
  "attemptedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "notification_attempt_notification_idx" ON "NotificationAttempt"("notificationId");
CREATE INDEX "notification_attempt_attempted_idx" ON "NotificationAttempt"("attemptedAt");

COMMENT ON TABLE "NotificationAttempt" IS 'Append-only audit trail of delivery attempts per notification.';

-- RLS: Notification
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_select_owner_or_super ON "Notification" FOR SELECT
  USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_insert_owner_or_super ON "Notification" FOR INSERT
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_update_owner_or_super ON "Notification" FOR UPDATE
  USING (gs_is_super() OR "userId" = gs_current_user_id())
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_delete_super_only ON "Notification" FOR DELETE
  USING (gs_is_super());

-- RLS: NotificationPreference
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_select_owner_or_super ON "NotificationPreference" FOR SELECT
  USING (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_preference_insert_owner_or_super ON "NotificationPreference" FOR INSERT
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_preference_update_owner_or_super ON "NotificationPreference" FOR UPDATE
  USING (gs_is_super() OR "userId" = gs_current_user_id())
  WITH CHECK (gs_is_super() OR "userId" = gs_current_user_id());
CREATE POLICY notification_preference_delete_super_only ON "NotificationPreference" FOR DELETE
  USING (gs_is_super());

-- RLS: NotificationAttempt (super-only read/append)
ALTER TABLE "NotificationAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_attempt_select_super_only ON "NotificationAttempt" FOR SELECT
  USING (gs_is_super());
CREATE POLICY notification_attempt_insert_super_only ON "NotificationAttempt" FOR INSERT
  WITH CHECK (gs_is_super());
CREATE POLICY notification_attempt_update_super_only ON "NotificationAttempt" FOR UPDATE
  USING (gs_is_super()) WITH CHECK (gs_is_super());
CREATE POLICY notification_attempt_delete_super_only ON "NotificationAttempt" FOR DELETE
  USING (gs_is_super());
