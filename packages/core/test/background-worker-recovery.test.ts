import { describe, expect, it, vi } from 'vitest';
import { runDispatchExpiryTick } from '../../../apps/worker/src/dispatch-expiry';
import { runCheckoutDraftRetentionTick } from '../../../apps/worker/src/checkout-draft-retention';
import { runKycRetentionTick } from '../../../apps/worker/src/kyc-retention';

function fixture() {
  const query = vi.fn(async (sql: string): Promise<any> => {
    if (sql.includes('gs_expire_dispatch_offers')) return { rows: [{ expired: 2 }] };
    if (sql.includes('gs_kyc_retention_tick')) return { rows: [{ n: 2 }] };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const connect = vi.fn().mockRejectedValueOnce(new Error('private-connection-detail')).mockResolvedValue({ query, release });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { query, release, connect, pool: { connect } as any, log: log as any, storage: { delete: vi.fn() } as any };
}

describe('background worker recovery from transient database failures', () => {
  it('returns safely after failed dispatch acquisition and resumes on the next tick', async () => {
    const f = fixture();
    expect(await runDispatchExpiryTick(f.pool, f.log, 10)).toBe(0);
    expect(f.log.error).toHaveBeenCalledWith('dispatch_expiry_failed', { error: 'DISPATCH_EXPIRY_ERROR' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
    expect(await runDispatchExpiryTick(f.pool, f.log, 10)).toBe(2);
    expect(f.query).toHaveBeenCalledWith('COMMIT'); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('private-connection-detail');
  });

  it('returns safely after failed test-only draft retention acquisition and resumes on the next tick', async () => {
    const f = fixture();
    expect(await runCheckoutDraftRetentionTick(f.pool, f.log, 10)).toBe(0);
    expect(f.log.error).toHaveBeenCalledWith('checkout_draft_retention_failed', {});
    expect(f.query).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
    expect(await runCheckoutDraftRetentionTick(f.pool, f.log, 10)).toBe(0);
    expect(f.query).toHaveBeenCalledWith('COMMIT'); expect(f.release).toHaveBeenCalledOnce();
    await expect(runCheckoutDraftRetentionTick(f.pool, f.log, 0)).rejects.toThrow('CHECKOUT_DRAFT_BATCH_INVALID');
    expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('private-connection-detail');
  });

  it.each(['dispatch', 'draft'] as const)('%s query failure rolls back, releases, and does not leak error text', async worker => {
    const f = fixture(); f.connect.mockReset().mockResolvedValue({ query: f.query, release: f.release });
    f.query.mockImplementation(async (sql: string) => {
      if (sql.includes('gs_expire_dispatch_offers') || sql.includes('FROM "Cart" c JOIN')) throw new Error('private-query-detail');
      if (sql === 'ROLLBACK') throw new Error('private-rollback-detail');
      return { rows: [] };
    });
    const run = worker === 'dispatch' ? runDispatchExpiryTick : runCheckoutDraftRetentionTick;
    expect(await run(f.pool, f.log, 10)).toBe(0);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK'); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.log.error.mock.calls)).not.toMatch(/private-query-detail|private-rollback-detail/);
  });

  it('returns a failure on KYC acquisition failure and resumes on the next tick', async () => {
    const f = fixture();
    expect(await runKycRetentionTick(f.pool, f.storage, f.log, 10, { nodeEnv: 'test' })).toEqual({ expired: 0, purged: 0, failed: 1 });
    expect(f.log.error).toHaveBeenCalledWith('kyc_retention_failed', { error: 'KYC_RETENTION_ERROR' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
    expect(await runKycRetentionTick(f.pool, f.storage, f.log, 10, { nodeEnv: 'test' })).toEqual({ expired: 2, purged: 0, failed: 0 });
    expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('private-connection-detail');
  });

  it.each(['development', 'staging', 'production', 'TEST', '', undefined])('does not purge KYC evidence outside explicit test mode: %s', async nodeEnv => {
    const f = fixture(); f.connect.mockReset().mockResolvedValue({ query: f.query, release: f.release });
    const result = await runKycRetentionTick(f.pool, f.storage, f.log, 10, nodeEnv === undefined ? undefined : { nodeEnv });
    expect(result).toEqual({ expired: 2, purged: 0, failed: 0 });
    expect(f.query).toHaveBeenCalledWith('COMMIT');
    expect(f.query.mock.calls.some(([sql]: [string]) => sql.includes('KycDeletionRequest'))).toBe(false);
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.log.warn).toHaveBeenCalledWith('kyc_retention_purge_disabled', { reason: 'TEST_ONLY' });
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('does not report unconfirmed KYC expiry as committed when COMMIT fails', async () => {
    const f = fixture(); f.connect.mockReset().mockResolvedValue({ query: f.query, release: f.release });
    f.query.mockImplementation(async (sql: string) => {
      if (sql.includes('gs_kyc_retention_tick')) return { rows: [{ n: 5 }] };
      if (sql === 'COMMIT') throw new Error('private-commit-detail');
      return { rows: [] };
    });
    expect(await runKycRetentionTick(f.pool, f.storage, f.log, 10, { nodeEnv: 'test' })).toEqual({ expired: 0, purged: 0, failed: 1 });
    expect(f.query).toHaveBeenCalledWith('ROLLBACK'); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('private-commit-detail');
  });

  it('preserves confirmed KYC expiry count if a later query fails', async () => {
    const f = fixture(); f.connect.mockReset().mockResolvedValue({ query: f.query, release: f.release });
    f.query.mockImplementation(async (sql: string) => {
      if (sql.includes('gs_kyc_retention_tick')) return { rows: [{ n: 3 }] };
      if (sql.includes('FROM "KycDeletionRequest" r')) throw new Error('private-case-detail');
      return { rows: [] };
    });
    expect(await runKycRetentionTick(f.pool, f.storage, f.log, 10, { nodeEnv: 'test' })).toEqual({ expired: 3, purged: 0, failed: 1 });
    expect(f.query).toHaveBeenCalledWith('ROLLBACK'); expect(f.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.log.error.mock.calls)).not.toContain('private-case-detail');
  });

  it('does not log KYC object paths, case details, or request IDs on a purge failure', async () => {
    const f = fixture(); f.connect.mockReset().mockResolvedValue({ query: f.query, release: f.release });
    f.query.mockImplementation(async (sql: string) => {
      if (sql.includes('gs_kyc_retention_tick')) return { rows: [{ n: 0 }] };
      if (sql.includes('FROM "KycDeletionRequest" r')) return { rows: [{ id: 'private-request-id', caseId: 'private-case-id', countryId: 'country' }] };
      if (sql.includes('SELECT status FROM "KycDeletionRequest"')) return { rows: [{ status: 'APPROVED' }] };
      if (sql.includes('FROM "KycLegalHold"')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM "KycDocument"')) return { rows: [{ objectKey: 'private-object-path' }] };
      return { rows: [] };
    });
    f.storage.delete.mockRejectedValue(new Error('private-object-path: delete failed'));
    expect(await runKycRetentionTick(f.pool, f.storage, f.log, 10, { nodeEnv: 'test' })).toEqual({ expired: 0, purged: 0, failed: 1 });
    expect(f.log.error).toHaveBeenCalledWith('kyc_retention_purge_failed', { error: 'KYC_RETENTION_PURGE_ERROR' });
    expect(JSON.stringify(f.log.error.mock.calls)).not.toMatch(/private-object-path|private-case-id|private-request-id/);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK'); expect(f.release).toHaveBeenCalledOnce();
  });
});
