-- Match DispatchOffer timestamp(3) storage precision. Rounding microseconds can
-- otherwise turn an exact 30-second interval into 29.999982 seconds.
-- VOLATILE prevents subquery pull-up from independently evaluating the clock
-- for offeredAt and expiresAt. No offer duration or authorization rule changes.
CREATE OR REPLACE FUNCTION gs_dispatch_now()
RETURNS TIMESTAMP LANGUAGE sql VOLATILE AS $$
  SELECT date_trunc('milliseconds', clock_timestamp()::timestamp);
$$;
COMMENT ON FUNCTION gs_dispatch_now() IS 'Database wall clock truncated to timestamp(3) precision; use one LATERAL value for related offer timestamps.';
