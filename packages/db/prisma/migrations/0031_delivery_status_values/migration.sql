-- Additive delivery lifecycle values. Enum values must be committed before use.
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'FULFILLING';
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
