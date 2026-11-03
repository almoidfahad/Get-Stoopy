import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/index.js';
const base={NODE_ENV:'test',WEB_ORIGIN:'http://localhost:3000',DATABASE_URL:'postgresql://runtime:secret@localhost/db',DATABASE_PRIVILEGED_URL:'postgresql://privileged:secret@localhost/db',REDIS_URL:'redis://localhost:6379',KEYCLOAK_ISSUER:'http://localhost:8080/realms/test',KEYCLOAK_CLIENT_ID:'web',KEYCLOAK_CLIENT_SECRET:'secret',BFF_API_SHARED_SECRET:'s'.repeat(32),SESSION_TOKEN_ENCRYPTION_KEY:'a'.repeat(64),STORAGE_ENCRYPTION_KEY:'b'.repeat(64)};
describe('payout activation boundary',()=>{
 it('defaults sandbox and live off',()=>{const env=loadApiEnv(base);expect(env.PAYOUTS_SANDBOX_ENABLED).toBe(false);expect(env.PAYOUTS_LIVE_ENABLED).toBe(false);});
 it('allows explicit non-production sandbox but never live or production sandbox',()=>{
  expect(loadApiEnv({...base,PAYOUTS_SANDBOX_ENABLED:'true'}).PAYOUTS_SANDBOX_ENABLED).toBe(true);
  expect(()=>loadApiEnv({...base,PAYOUTS_LIVE_ENABLED:'true'})).toThrow('PAYOUTS_LIVE_NOT_AUTHORIZED');
  expect(()=>loadApiEnv({...base,NODE_ENV:'production',WEB_ORIGIN:'https://shop.example.test',KEYCLOAK_ISSUER:'https://id.example.test/realms/test',SESSION_COOKIE_NAME:'__Host-gs_session',PAYOUTS_SANDBOX_ENABLED:'true'})).toThrow('PAYOUT_SANDBOX_FORBIDDEN_IN_PRODUCTION');
 });
});
