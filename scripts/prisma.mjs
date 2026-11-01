import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
if (existsSync('.env')) config({ path: '.env', quiet: true });
const args = process.argv.slice(2);
const r = spawnSync('prisma', [...args, '--schema', 'packages/db/prisma/schema.prisma'], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
