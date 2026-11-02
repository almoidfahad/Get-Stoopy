import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const url = process.env['DATABASE_PRIVILEGED_URL'];
if (!url) throw new Error('DATABASE_PRIVILEGED_URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.is_super', 'true', true)`;
    const country = await tx.country.upsert({ where: { iso2: 'BD' }, update: {}, create: { iso2: 'BD', name: 'Bangladesh', currencyCode: 'BDT', callingCode: '+880', timezone: 'Asia/Dhaka', status: 'ACTIVE' } });

    // Seed permission definitions only. Sensitive reviewer/finance permissions are NOT
    // attached to the generic country_admin role; no user credentials or admin identity are fabricated.
    const basePerms = [
      { key: 'admin:example:read', resource: 'admin', action: 'example:read', sensitivity: 'internal' },
      { key: 'admin:geography:read', resource: 'admin', action: 'geography:read', sensitivity: 'internal' },
      { key: 'admin:scope:grant', resource: 'admin', action: 'scope:grant', sensitivity: 'critical' }
    ];
    const kycReviewerPerms = [
      { key: 'storage:kyc:review', resource: 'storage', action: 'kyc:review', sensitivity: 'critical' },
      { key: 'kyc:case:review', resource: 'kyc', action: 'case:review', sensitivity: 'critical' }
    ];
    const financePerms = [
      { key: 'finance:ledger:post', resource: 'finance', action: 'ledger:post', sensitivity: 'critical' },
      { key: 'finance:ledger:read', resource: 'finance', action: 'ledger:read', sensitivity: 'high' }
    ];
    for (const p of [...basePerms, ...kycReviewerPerms, ...financePerms]) await tx.permission.upsert({ where: { key: p.key }, update: {}, create: p });

    const role = await tx.role.upsert({ where: { key: 'country_admin' }, update: {}, create: { key: 'country_admin', name: 'Country Admin', description: 'Development country-scoped administrator; sensitive review/finance permissions are separate' } });
    for (const p of basePerms) {
      const permission = await tx.permission.findUniqueOrThrow({ where: { key: p.key } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }

    const kycRole = await tx.role.upsert({ where: { key: 'kyc_reviewer' }, update: {}, create: { key: 'kyc_reviewer', name: 'KYC Reviewer', description: 'Requires explicit assignment, geographic scope and step-up; no self-review' } });
    for (const p of kycReviewerPerms) {
      const permission = await tx.permission.findUniqueOrThrow({ where: { key: p.key } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: kycRole.id, permissionId: permission.id } }, update: {}, create: { roleId: kycRole.id, permissionId: permission.id } });
    }

    const financeRole = await tx.role.upsert({ where: { key: 'finance_ledger' }, update: {}, create: { key: 'finance_ledger', name: 'Finance Ledger', description: 'Privileged ledger primitives; domain finance commands are not implemented yet' } });
    for (const p of financePerms) {
      const permission = await tx.permission.findUniqueOrThrow({ where: { key: p.key } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: financeRole.id, permissionId: permission.id } }, update: {}, create: { roleId: financeRole.id, permissionId: permission.id } });
    }

    console.log(JSON.stringify({ seeded: true, countryId: country.id, roleId: role.id, kycRoleId: kycRole.id, financeRoleId: financeRole.id, note: 'No user credentials or admin identity were fabricated. Sensitive permissions require explicit role assignment and scope.' }));
  });
}
main().finally(() => db.$disconnect());
