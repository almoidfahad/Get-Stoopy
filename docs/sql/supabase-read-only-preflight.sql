-- Get Stoopy Supabase preflight: READ ONLY. No application or customer rows.
-- Run in the intended project's SQL Editor. It does not create tables, roles,
-- extensions or alter permissions. Review results before planning migrations.
-- Output contains metadata (table/role names); review before sharing.

-- 1. Project database state and prerequisites.
SELECT current_database() AS database_name,
       current_user AS query_role,
       version() AS postgres_version,
       EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') AS postgis_available,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis_installed,
       to_regclass('public._prisma_migrations') IS NOT NULL AS prisma_migration_ledger_present,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) AS public_table_count;

-- 2. Required application roles: flags alone do not prove permissions are safe.
SELECT expected.role_name, r.oid IS NOT NULL AS present,
       r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls, r.rolcanlogin AS can_login
FROM (VALUES ('gs_owner'), ('gs_runtime'), ('gs_privileged')) AS expected(role_name)
LEFT JOIN pg_roles r ON r.rolname = expected.role_name
ORDER BY expected.role_name;

-- 3. All 103 Prisma models expected by this repository revision. The RLS flags
-- do not establish that policies or grants are correct. This is an inventory,
-- not a migration, and names are case-sensitive.
WITH expected(table_name) AS (
  VALUES
    ('User'),
    ('UserIdentity'),
    ('Role'),
    ('Permission'),
    ('RolePermission'),
    ('UserRole'),
    ('AdminScope'),
    ('Session'),
    ('Country'),
    ('Region'),
    ('District'),
    ('City'),
    ('ServiceZone'),
    ('Neighborhood'),
    ('BoundaryVersion'),
    ('StorePickupPoint'),
    ('StoreOperatingHour'),
    ('StoreServiceArea'),
    ('RiderShift'),
    ('RiderLocationConsent'),
    ('RiderLocationSample'),
    ('RiderZoneGrant'),
    ('OrderDeliveryDestination'),
    ('DispatchRun'),
    ('DispatchOffer'),
    ('RiderAssignment'),
    ('DispatchEvent'),
    ('DeliveryRecipient'),
    ('Delivery'),
    ('DeliveryOtpChallenge'),
    ('DeliveryOtpAttempt'),
    ('DeliveryProof'),
    ('DeliveryEvent'),
    ('AuditLog'),
    ('OutboxEvent'),
    ('InboxReceipt'),
    ('InboxDeadLetter'),
    ('IdempotencyRecord'),
    ('FeatureFlag'),
    ('UserMfa'),
    ('RecoveryCode'),
    ('StorageObject'),
    ('LedgerAccount'),
    ('LedgerJournal'),
    ('LedgerLine'),
    ('KycCase'),
    ('KycDocument'),
    ('KycReview'),
    ('Vendor'),
    ('VendorMembership'),
    ('RiderProfile'),
    ('Store'),
    ('Product'),
    ('ProductVariant'),
    ('Category'),
    ('ProductImage'),
    ('Inventory'),
    ('InventoryMovement'),
    ('InventoryReservation'),
    ('Cart'),
    ('CartItem'),
    ('CheckoutQuote'),
    ('CheckoutQuoteGroup'),
    ('CheckoutQuoteItem'),
    ('Order'),
    ('VendorSuborder'),
    ('VendorSuborderStatusEvent'),
    ('OrderItem'),
    ('PaymentIntent'),
    ('PaymentWebhookEvent'),
    ('CodPolicy'),
    ('OrderCancellation'),
    ('RefundRequest'),
    ('RefundReview'),
    ('RiderRateRule'),
    ('RiderRateSlab'),
    ('RiderRateSnapshot'),
    ('RiderEarning'),
    ('CodCollection'),
    ('CodDeposit'),
    ('CodAllocation'),
    ('PayoutDestination'),
    ('PayoutDestinationReview'),
    ('VendorCommissionPolicy'),
    ('VendorSettlement'),
    ('VendorSettlementItem'),
    ('VendorSettlementReview'),
    ('RefundExecution'),
    ('VendorPayout'),
    ('TransferAttempt'),
    ('FinanceAdjustment'),
    ('ProviderStatementEntry'),
    ('AdminActivation'),
    ('KycRetentionPolicy'),
    ('KycLegalHold'),
    ('KycDeletionRequest'),
    ('KycRetentionEvent'),
    ('RiskCase'),
    ('RiskSignal'),
    ('RiskCaseReview'),
    ('Notification'),
    ('NotificationPreference'),
    ('NotificationAttempt')
)
SELECT expected.table_name, c.oid IS NOT NULL AS present,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM expected
LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = expected.table_name AND c.relkind IN ('r', 'p')
ORDER BY expected.table_name;

-- 4. ONLY if prisma_migration_ledger_present is true, run this separately:
-- SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
-- FROM public."_prisma_migrations" ORDER BY started_at, migration_name;
-- Do not paste logs, credentials, tokens, customer rows or passwords into chat.
