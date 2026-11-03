-- Fix PL/pgSQL record-variable/table-alias ambiguity in 0042; behavior unchanged.
CREATE OR REPLACE FUNCTION gs_delivery_finance_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ord "Order"%ROWTYPE;
BEGIN
  IF NEW."status" <> 'COMPLETED' THEN RETURN NULL; END IF;
  SELECT o.* INTO ord FROM "Order" o JOIN "VendorSuborder" s ON s."orderId"=o."id" WHERE s."id"=NEW."suborderId";
  IF NOT EXISTS (SELECT 1 FROM "RiderEarning" e WHERE e."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'delivery_earning_required'; END IF;
  IF ord."paymentMethod"='COD' AND NOT EXISTS (SELECT 1 FROM "CodCollection" c WHERE c."deliveryId"=NEW."id") THEN RAISE EXCEPTION 'cod_accounting_required'; END IF;
  RETURN NULL;
END; $$;
