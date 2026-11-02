-- Additive enum values for the implemented vendor readiness slice.
-- Kept separate because PostgreSQL cannot consume new enum values in the same transaction.
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
