import type { Pool, PoolClient } from 'pg';
import type { StructuredLogger } from '@getstoopy/observability';

export function checkoutDraftRetentionAllowed(nodeEnv: string, enabled: boolean, hasPrivilegedDatabase: boolean): boolean {
  return !enabled || (nodeEnv === 'test' && hasPrivilegedDatabase);
}

/**
 * Bounded test-only retention tick. Clear current expired envelopes, retaining
 * version tombstones. This is not physical erasure of WAL, replicas or backups.
 * Callers must enable it only in the isolated test environment.
 */
export async function runCheckoutDraftRetentionTick(pool: Pool, log: StructuredLogger, batchSize: number): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('CHECKOUT_DRAFT_BATCH_INVALID');
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_super','true',true)");
    await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',true)");
    // Same cart-first lock order as save/clear. SKIP LOCKED lets active buyer
    // requests and other workers proceed. Recheck expiry in the UPDATE.
    const due = await client.query<{ cartId: string; userId: string; countryId: string }>(`
      SELECT c.id AS "cartId", c."userId", c."countryId"
      FROM "Cart" c JOIN "CheckoutRecipientDraft" d ON d."cartId"=c.id
      WHERE d.envelope IS NOT NULL AND d."expiresAt"<=gs_dispatch_now()
      ORDER BY d."expiresAt", c.id LIMIT $1 FOR UPDATE OF c SKIP LOCKED`, [batchSize]);
    let cleared = 0;
    for (const row of due.rows) {
      // The draft guard requires the cart owner's actor context even for the
      // privileged worker. Each transaction-local value is overwritten per row.
      await client.query("SELECT set_config('app.user_id',$1,true)", [row.userId]);
      const result = await client.query(`UPDATE "CheckoutRecipientDraft"
        SET envelope=NULL, "expiresAt"=NULL, version=version+1, "updatedAt"=gs_dispatch_now()
        WHERE "cartId"=$1 AND envelope IS NOT NULL AND "expiresAt"<=gs_dispatch_now() RETURNING version`, [row.cartId]);
      if (!result.rowCount) continue;
      await client.query(`INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId")
        VALUES (gen_random_uuid(),'SYSTEM','commerce.checkout.recipient_draft.expired','Cart',$1,jsonb_build_object('countryId',$2::text),gen_random_uuid())`, [row.cartId, row.countryId]);
      cleared++;
    }
    await client.query('COMMIT');
    if (cleared) log.info('checkout_draft_retention_batch', { cleared });
    return cleared;
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    // Never include row contents, database parameters or error detail in logs.
    log.error('checkout_draft_retention_failed', {});
    return 0;
  } finally { client?.release(); }
}
