import { describe, expect, it } from 'vitest';
import { asSuper, urls } from './helpers';

const u = urls();

describe('dispatch geometry operator compatibility', () => {
  it('compares points with schema-qualified PostGIS equality even when public is not in search_path', async () => {
    const result = await asSuper(u.privileged, async client => {
      // PostGIS 3.4 has no geometry <> operator; excluding public reproduces the
      // ambiguous unqualified-operator resolution seen in CI while keeping the
      // explicit extension-schema operator resolvable.
      await client.query('SET LOCAL search_path = pg_catalog');
      return client.query(`
        SELECT NOT (a OPERATOR(public.=) b) AS same_point_distinct,
               NOT (a OPERATOR(public.=) c) AS different_point_distinct
        FROM (
          SELECT public.ST_SetSRID(public.ST_MakePoint(90.401, 24.751), 4326) AS a,
                 public.ST_SetSRID(public.ST_MakePoint(90.401, 24.751), 4326) AS b,
                 public.ST_SetSRID(public.ST_MakePoint(90.402, 24.751), 4326) AS c
        ) points
      `);
    });
    expect(result.rows[0].same_point_distinct).toBe(false);
    expect(result.rows[0].different_point_distinct).toBe(true);
  });

  it('keeps dispatch point snapshot guards on explicit PostGIS equality', async () => {
    const result = await asSuper(u.privileged, client => client.query(
      `SELECT pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'gs_dispatch_run_guard'`
    ));
    const definition = result.rows[0].definition as string;
    expect(definition.match(/OPERATOR\(public\.=\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(definition).not.toMatch(/"(?:pickupPoint|destinationPoint)"\s*(?:<>|IS DISTINCT FROM)/);
  });
});
