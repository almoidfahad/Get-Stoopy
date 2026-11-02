import type { Pool } from 'pg';
import type { StructuredLogger } from '@getstoopy/observability';

/** Bounded idempotent DB-time expiry/escalation wake. Database status is authoritative. */
export async function runDispatchExpiryTick(pool: Pool, log: StructuredLogger, batchSize: number): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_super','true',true)");
    await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',true)");
    const result = await client.query('SELECT gs_expire_dispatch_offers($1) AS expired', [batchSize]);
    await client.query('COMMIT');
    const expired = Number(result.rows[0]?.expired ?? 0);
    if (expired > 0) log.info('dispatch_expiry_batch', { expired });
    return expired;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    log.error('dispatch_expiry_failed', { error: err instanceof Error ? err.message : 'unknown' });
    return 0;
  } finally { client.release(); }
}
