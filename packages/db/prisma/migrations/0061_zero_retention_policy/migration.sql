-- Owner-approved policy may specify immediate deletion (0 days) for rejected/revoked/expired evidence.
ALTER TABLE "KycRetentionPolicy" DROP CONSTRAINT "KycRetentionPolicy_approvedRetentionDays_check";
ALTER TABLE "KycRetentionPolicy" DROP CONSTRAINT "KycRetentionPolicy_rejectedRetentionDays_check";
ALTER TABLE "KycRetentionPolicy" DROP CONSTRAINT "KycRetentionPolicy_revokedRetentionDays_check";
ALTER TABLE "KycRetentionPolicy" ADD CONSTRAINT "KycRetentionPolicy_approvedRetentionDays_check" CHECK ("approvedRetentionDays" BETWEEN 0 AND 3650);
ALTER TABLE "KycRetentionPolicy" ADD CONSTRAINT "KycRetentionPolicy_rejectedRetentionDays_check" CHECK ("rejectedRetentionDays" BETWEEN 0 AND 3650);
ALTER TABLE "KycRetentionPolicy" ADD CONSTRAINT "KycRetentionPolicy_revokedRetentionDays_check" CHECK ("revokedRetentionDays" BETWEEN 0 AND 3650);
