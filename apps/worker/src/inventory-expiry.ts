import type { Pool, PoolClient } from 'pg';
import type { StructuredLogger } from '@getstoopy/observability';

/** Each transaction handles one entire quote or one standalone reservation.
 * The batch size is a soft reservation budget: an atomic quote can exceed it.
 */
export async function runInventoryExpiryTick(pool: Pool, log: StructuredLogger, batchSize: number): Promise<number> {
  let client: PoolClient | undefined;
  let expired = 0;
  try {
    // A transient connection failure must not reject and terminate the worker's
    // polling loop. The next tick will attempt to acquire a connection again.
    client = await pool.connect();
    // The database validates the supplied size; never run an unbounded loop.
    for (let unit = 0; unit < 500; unit++) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_super','true',true)");
      await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',true)");
      const result = await client.query('SELECT gs_expire_inventory_reservations($1) AS expired', [batchSize]);
      const count = Number(result.rows[0]?.expired ?? 0);
      await client.query('COMMIT');
      expired += count;
      if (count === 0 || expired >= batchSize) break;
    }
    if (expired > 0) log.info('inventory_expiry_batch', { expired });
    return expired;
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    // Database errors can contain connection details or values. Do not log
    // exception text; retain the committed count for operational monitoring.
    log.error('inventory_expiry_failed', { error: 'INVENTORY_EXPIRY_ERROR', expired });
    // Prior units committed independently and must not be reported as zero.
    return expired;
  } finally {
    client?.release();
  }
}
