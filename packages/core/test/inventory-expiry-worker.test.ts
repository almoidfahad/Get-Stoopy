import { describe, expect, it, vi } from 'vitest';
import { runInventoryExpiryTick } from '../../../apps/worker/src/inventory-expiry';

function fixture(counts: number[], failAt = -1) {
  let calls = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT gs_expire_inventory_reservations')) {
      const index = calls++;
      if (index === failAt) throw new Error('test failure');
      return { rows: [{ expired: counts[index] ?? 0 }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as any;
  const log = { info: vi.fn(), error: vi.fn() } as any;
  return { query, release, pool, log };
}

describe('inventory expiry worker', () => {
  it('commits each unit separately until the work budget is met', async () => {
    const f = fixture([1, 1, 1]);
    expect(await runInventoryExpiryTick(f.pool, f.log, 2)).toBe(2);
    expect(f.query.mock.calls.filter(c => c[0] === 'BEGIN')).toHaveLength(2);
    expect(f.query.mock.calls.filter(c => c[0] === 'COMMIT')).toHaveLength(2);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('does not split a quote when its item count exceeds the budget', async () => {
    const f = fixture([4]);
    expect(await runInventoryExpiryTick(f.pool, f.log, 1)).toBe(4);
    expect(f.query.mock.calls.filter(c => c[0] === 'COMMIT')).toHaveLength(1);
  });
  it('reports earlier committed work if a later unit fails', async () => {
    const f = fixture([1], 1);
    expect(await runInventoryExpiryTick(f.pool, f.log, 5)).toBe(1);
    expect(f.query.mock.calls.filter(c => c[0] === 'COMMIT')).toHaveLength(1);
    expect(f.query.mock.calls.filter(c => c[0] === 'ROLLBACK')).toHaveLength(1);
    expect(f.log.error).toHaveBeenCalledWith('inventory_expiry_failed', { error: 'test failure', expired: 1 });
    expect(f.release).toHaveBeenCalledOnce();
  });
});
