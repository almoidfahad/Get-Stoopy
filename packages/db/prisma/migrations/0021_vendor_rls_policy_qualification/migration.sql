-- Additive security fix: qualify the outer Vendor id in the membership EXISTS policy.
-- The original 0014 policy used an unqualified "id" inside the subquery, which bound
-- to VendorMembership.id and prevented non-owner members from reading their vendor.
ALTER POLICY vendor_select_owner_member_or_super ON "Vendor"
  USING (
    "Vendor"."ownerUserId" = gs_current_user_id() OR gs_is_super() OR EXISTS (
      SELECT 1 FROM "VendorMembership" m
      WHERE m."vendorId" = "Vendor"."id"
        AND m."userId" = gs_current_user_id()
        AND m."revokedAt" IS NULL
        AND (m."expiresAt" IS NULL OR m."expiresAt" > CURRENT_TIMESTAMP)
    )
  );
