import { describe, expect, it } from 'vitest';
import { asSuper, urls } from './helpers';

const u = urls();

describe('dispatch database clock precision', () => {
  it('returns values that round-trip through timestamp(3) without drift', async () => {
    const result = await asSuper(u.privileged, client => client.query(`
      SELECT bool_and(sample = date_trunc('milliseconds', sample) AND sample::timestamp(3) = sample) AS precise
      FROM generate_series(1, 1000) AS n
      CROSS JOIN LATERAL (SELECT gs_dispatch_now() AS sample) clock
    `));
    expect(result.rows[0].precise).toBe(true);
  });

  it('preserves an exact 30-second TTL from one DB instant across repeated samples', async () => {
    const result = await asSuper(u.privileged, client => client.query(`
      SELECT count(*) FILTER (WHERE expires_at <> offered_at + interval '30 seconds') AS violations
      FROM generate_series(1, 1000) AS n
      CROSS JOIN LATERAL (SELECT gs_dispatch_now() AS now) clock
      CROSS JOIN LATERAL (
        SELECT clock.now::timestamp(3) AS offered_at,
               (clock.now + interval '30 seconds')::timestamp(3) AS expires_at
      ) stored
    `));
    expect(Number(result.rows[0].violations)).toBe(0);
  });
});
