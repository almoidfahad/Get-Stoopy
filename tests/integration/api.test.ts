import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { urls, asSuper } from './helpers';
const u = urls();
const userId = randomUUID();
const token = `api-test-${randomUUID()}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
let app: any;
beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['WEB_ORIGIN'] = 'http://localhost:3000';
  process.env['DATABASE_URL'] = u.runtime;
  process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy';
  process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web';
  process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000';
  process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'b'.repeat(64); process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64);
  process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  const { createApp } = await import('../../apps/api/src/main');
  app = await createApp(); await app.init();
  await asSuper(u.privileged, async c => {
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())', [userId, 'API Test User']);
    await c.query('INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'15 minutes\',1)', [randomUUID(), userId, tokenHash]);
  });
});
afterAll(async () => { if (app) await app.close(); });
describe('NestJS API shell', () => {
  it('health live', async () => { await request(app.getHttpServer()).get('/api/v1/health/live').expect(200); });
  it('health ready checks real database', async () => { await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200); });
  it('rejects unauthenticated me', async () => { await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401); });
  it('resolves opaque session through RLS', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
    expect(res.body.user.id).toBe(userId);
    expect(res.body.csrfToken).toBeTruthy();
  });
  it('denies admin example without geographic scope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/admin/example?countryId=' + randomUUID()).set('Cookie', `gs_session_dev=${token}`).expect(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });
  it('rejects logout without CSRF/origin', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', `gs_session_dev=${token}`).expect(403);
  });
  it('rejects BFF session creation without shared secret', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/session').send({ idToken: 'x' }).expect(401);
  });
});
