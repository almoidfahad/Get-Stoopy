import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const url = process.env['DATABASE_PRIVILEGED_URL'];
if (!url) throw new Error('DATABASE_PRIVILEGED_URL required');
const db = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.is_super', 'true', true)`;
    const country = await tx.country.upsert({ where: { iso2: 'BD' }, update: {}, create: { iso2: 'BD', name: 'Bangladesh', currencyCode: 'BDT', callingCode: '+880', timezone: 'Asia/Dhaka', status: 'ACTIVE' } });
    const perms = [
      { key: 'admin:example:read', resource: 'admin', action: 'example:read', sensitivity: 'internal' },
      { key: 'admin:geography:read', resource: 'admin', action: 'geography:read', sensitivity: 'internal' },
      { key: 'admin:scope:grant', resource: 'admin', action: 'scope:grant', sensitivity: 'critical' },
      { key: 'storage:kyc:review', resource: 'storage', action: 'kyc:review', sensitivity: 'critical' },
      { key: 'finance:ledger:post', resource: 'finance', action: 'ledger:post', sensitivity: 'critical' },
      { key: 'finance:ledger:read', resource: 'finance', action: 'ledger:read', sensitivity: 'high' }
    ];
    for (const p of perms) await tx.permission.upsert({ where: { key: p.key }, update: {}, create: p });
    const role = await tx.role.upsert({ where: { key: 'country_admin' }, update: {}, create: { key: 'country_admin', name: 'Country Admin', description: 'Development country-scoped administrator' } });
    for (const p of perms) {
      const permission = await tx.permission.findUniqueOrThrow({ where: { key: p.key } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
    console.log(JSON.stringify({ seeded: true, countryId: country.id, roleId: role.id, note: 'No user credentials or admin identity were fabricated.' }));
  });
}
main().finally(() => db.$disconnect());
