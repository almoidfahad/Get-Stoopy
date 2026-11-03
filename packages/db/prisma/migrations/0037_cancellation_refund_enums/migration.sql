-- Additive enum values only. Keep enum additions separate from their first use.
CREATE TYPE "OrderLifecycleStatus" AS ENUM ('ACTIVE','CANCELLED');
ALTER TYPE "VendorSuborderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "InventoryMovementKind" ADD VALUE IF NOT EXISTS 'RESTOCK';
CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING_REVIEW','APPROVED','REJECTED');
CREATE TYPE "RefundReviewDecision" AS ENUM ('APPROVE','REJECT');
