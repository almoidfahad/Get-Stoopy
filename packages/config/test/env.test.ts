import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/index.js';
const valid = { WEB_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgresql://x:y@localhost/db', REDIS_URL: 'redis://localhost:6379', KEYCLOAK_ISSUER: 'http://localhost:8080/realms/get-stoopy', KEYCLOAK_CLIENT_ID: 'web', KEYCLOAK_CLIENT_SECRET: 'local' };
describe('env', () => {
  it('defaults live flags false', () => { const e = loadEnv(valid as any); expect(e.PAYMENTS_LIVE_ENABLED).toBe(false); expect(e.CROSS_BORDER_ENABLED).toBe(false); });
  it('rejects cross-border enablement', () => expect(() => loadEnv({ ...valid, CROSS_BORDER_ENABLED: 'true' } as any)).toThrow('CROSS_BORDER_NOT_AUTHORIZED'));
  it('rejects production http', () => expect(() => loadEnv({ ...valid, NODE_ENV: 'production' } as any)).toThrow('PROD_HTTP_FORBIDDEN'));
  it('keeps road routing and dispatch expiry disabled by default', () => { const e = loadEnv(valid as any); expect(e.ROAD_ROUTING_ENABLED).toBe(false); expect(e.DISPATCH_EXPIRY_ENABLED).toBe(false); });
  it('keeps risk signal producers disabled by default and unauthorized in production', () => {
    const e = loadEnv(valid as any); expect(e.RISK_SIGNAL_PRODUCERS_ENABLED).toBe(false);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', WEB_ORIGIN: 'https://x.example', KEYCLOAK_ISSUER: 'https://id.example', SESSION_COOKIE_NAME: '__Host-gs_session', RISK_SIGNAL_PRODUCERS_ENABLED: 'true' } as any)).toThrow('RISK_SIGNAL_PRODUCERS_NOT_AUTHORIZED');
  });
  it('keeps delivery OTP disabled by default', () => { const e = loadEnv(valid as any); expect(e.DELIVERY_OTP_ENABLED).toBe(false); expect(e.DELIVERY_OTP_CHANNEL).toBe('disabled'); });
  it('accepts only a 256-bit hex key for the test-only recipient draft', () => {
    expect(loadEnv(valid as any).CHECKOUT_RECIPIENT_DRAFT_KEY).toBeUndefined();
    expect(loadEnv({ ...valid, CHECKOUT_RECIPIENT_DRAFT_KEY: 'a'.repeat(64) } as any).CHECKOUT_RECIPIENT_DRAFT_KEY).toBe('a'.repeat(64));
    expect(() => loadEnv({ ...valid, CHECKOUT_RECIPIENT_DRAFT_KEY: 'not-a-key' } as any)).toThrow();
  });
  it('requires host cookie in production', () => expect(() => loadEnv({ ...valid, NODE_ENV: 'production', WEB_ORIGIN: 'https://x.example', KEYCLOAK_ISSUER: 'https://id.example', SESSION_COOKIE_NAME: 'gs' } as any)).toThrow('HOST_COOKIE_REQUIRED'));
});
