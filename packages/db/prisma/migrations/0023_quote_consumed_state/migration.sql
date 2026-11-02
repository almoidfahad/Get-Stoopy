-- Additive enum value; must commit before use in later migration.
ALTER TYPE "CheckoutQuoteState" ADD VALUE IF NOT EXISTS 'CONSUMED';
