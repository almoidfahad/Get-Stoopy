-- Delivery completion needs a bounded privileged UPDATE path on RiderAssignment.
-- The assignment guard still rejects route/identity changes and only allows
-- ACTIVE -> COMPLETED after the related Delivery is COMPLETED.
CREATE POLICY rider_assignment_update_super ON "RiderAssignment"
  FOR UPDATE USING (gs_is_super()) WITH CHECK (gs_is_super());
