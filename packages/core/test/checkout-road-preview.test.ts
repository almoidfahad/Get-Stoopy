import { describe, expect, it, vi } from 'vitest';
import { RecipientDraftService } from '../../../apps/api/src/commerce/recipient-draft.service';

const key = 'd'.repeat(64);
const base = { NODE_ENV: 'test', CHECKOUT_RECIPIENT_DRAFT_KEY: key, ROAD_ROUTING_ENABLED: true, ROAD_ROUTING_PROVIDER: 'google_routes', GOOGLE_ROUTES_API_KEY: 'synthetic-test-key-not-real', GOOGLE_ROUTES_BASE_URL: 'http://127.0.0.1:54321' };
const ctx = { userId: 'user', authorizationVersion: 1 } as any;
const input = { expectedVersion: 1, expectedDraftVersion: 1 };

describe('test-only checkout road-distance preview boundaries', () => {
  it.each(['production', 'staging', 'development'])('fails before a DB transaction in %s', async environment => {
    const db = { $transaction: vi.fn() };
    const service = new RecipientDraftService(db as any, { ...base, NODE_ENV: environment } as any, {} as any);
    await expect(service.previewRoadDistances(ctx, 'cart', input)).rejects.toMatchObject({ status: 503, response: { code: 'CHECKOUT_DRAFT_DISABLED' } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects nonlocal or malformed provider endpoints before database or network access', async () => {
    for (const url of ['https://routes.googleapis.com', 'http://127.0.0.2:9999', 'http://localhost.evil.example:9999', 'http://127.0.0.1', 'http://user:pass@127.0.0.1:9999', 'http://127.0.0.1:9999/proxy', 'http://127.0.0.1:9999?x=1', 'file:///etc/passwd', 'invalid']) {
      const db = { $transaction: vi.fn() };
      const service = new RecipientDraftService(db as any, { ...base, GOOGLE_ROUTES_BASE_URL: url } as any, {} as any);
      await expect(service.previewRoadDistances(ctx, 'cart', input)).rejects.toMatchObject({ status: 503, response: { code: 'CHECKOUT_ROUTE_PREVIEW_DISABLED' } });
      expect(db.$transaction).not.toHaveBeenCalled();
    }
  });
  it('requires enabled stub settings and valid versions', async () => {
    for (const overrides of [{ ROAD_ROUTING_ENABLED: false }, { ROAD_ROUTING_PROVIDER: 'disabled' }, { GOOGLE_ROUTES_API_KEY: undefined }]) {
      const db = { $transaction: vi.fn() };
      const service = new RecipientDraftService(db as any, { ...base, ...overrides } as any, {} as any);
      await expect(service.previewRoadDistances(ctx, 'cart', input)).rejects.toMatchObject({ response: { code: 'CHECKOUT_ROUTE_PREVIEW_DISABLED' } });
      expect(db.$transaction).not.toHaveBeenCalled();
    }
    const db = { $transaction: vi.fn() };
    const service = new RecipientDraftService(db as any, base as any, {} as any);
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN]) await expect(service.previewRoadDistances(ctx, 'cart', { expectedVersion: invalid, expectedDraftVersion: 1 })).rejects.toMatchObject({ status: 400 });
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN]) await expect(service.previewRoadDistances(ctx, 'cart', { expectedVersion: 1, expectedDraftVersion: invalid })).rejects.toMatchObject({ status: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
