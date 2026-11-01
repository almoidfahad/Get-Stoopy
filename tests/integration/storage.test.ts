import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { urls, asSuper } from './helpers';
const u = urls();
let app: any;
const origin = 'http://localhost:3000';
async function makeUser(label: string) {
  const userId = randomUUID(); const token = `storage-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())', [userId, `Storage ${label}`]);
    await c.query('INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'15 minutes\',1)', [randomUUID(), userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, token, csrf: me.body.csrfToken as string };
}
beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
});
afterAll(async () => { if (app) await app.close(); });
describe('private encrypted storage API', () => {
  it('uploads encrypted KYC object and downloads with short-lived token', async () => {
    const u1 = await makeUser('owner'); const data = Buffer.from('%PDF-1.4 fake kyc bytes');
    const create = await request(app.getHttpServer()).post('/api/v1/storage/uploads').set('Cookie', `gs_session_dev=${u1.token}`).set('Origin', origin).set('X-CSRF-Token', u1.csrf).send({ purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: data.length }).expect(201);
    const objectId = create.body.objectId;
    await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${objectId}`).set('Cookie', `gs_session_dev=${u1.token}`).set('X-Storage-Token', create.body.token).set('Content-Type', 'application/pdf').send(data).expect(200);
    const url = await request(app.getHttpServer()).post(`/api/v1/storage/objects/${objectId}/download-url`).set('Cookie', `gs_session_dev=${u1.token}`).set('Origin', origin).set('X-CSRF-Token', u1.csrf).expect(201);
    const dl = await request(app.getHttpServer()).get(url.body.downloadUrl).expect(200);
    expect(Buffer.from(dl.body).equals(data)).toBe(true);
    const u2 = await makeUser('other');
    await request(app.getHttpServer()).post(`/api/v1/storage/objects/${objectId}/download-url`).set('Cookie', `gs_session_dev=${u2.token}`).set('Origin', origin).set('X-CSRF-Token', u2.csrf).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/storage/downloads/${objectId}?token=bad`).expect(403);
  });
  it('rejects disallowed purpose/content-type and size mismatch', async () => {
    const u1 = await makeUser('bad');
    await request(app.getHttpServer()).post('/api/v1/storage/uploads').set('Cookie', `gs_session_dev=${u1.token}`).set('Origin', origin).set('X-CSRF-Token', u1.csrf).send({ purpose: 'kyc-document', contentType: 'text/html', sizeBytes: 10 }).expect(400);
    const create = await request(app.getHttpServer()).post('/api/v1/storage/uploads').set('Cookie', `gs_session_dev=${u1.token}`).set('Origin', origin).set('X-CSRF-Token', u1.csrf).send({ purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: 5 }).expect(201);
    await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${create.body.objectId}`).set('Cookie', `gs_session_dev=${u1.token}`).set('X-Storage-Token', create.body.token).send(Buffer.from('toolarge')).expect(400);
  });
});
