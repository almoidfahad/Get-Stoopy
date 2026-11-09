import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { urls, asSuper } from './helpers';
const u = urls();
let app: any;
const origin = 'http://localhost:3000';
async function makeUser(label: string) {
  const userId = randomUUID(); const token = `storage-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())', [userId, `Storage ${label}`]);
    await c.query('INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'15 minutes\',1)', [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
async function grantReviewer(user: { userId: string; sessionId: string }, stepUp = true) {
  await asSuper(u.privileged, async c => {
    const perm = await c.query('INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id', [randomUUID(), 'storage:kyc:review', 'storage', 'kyc:review', 'critical']);
    const role = await c.query('INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id', [randomUUID(), `storage-reviewer-${randomUUID()}`, 'Storage Reviewer']);
    await c.query('INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)', [role.rows[0].id, perm.rows[0].id]);
    await c.query('INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)', [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    if (stepUp) await c.query('UPDATE "Session" SET "assuranceLevel"=\'STEP_UP\', "stepUpExpiresAt"=now()+interval \'10 minutes\' WHERE id=$1', [user.sessionId]);
  });
}
function post(path: string, u: { token: string; csrf: string }, body: unknown = {}) { return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${u.token}`).set('Origin', origin).set('X-CSRF-Token', u.csrf).send(body); }
beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
});
afterAll(async () => { if (app) await app.close(); });
describe('private encrypted storage API with quarantine review', () => {
  it('quarantines KYC upload, requires privileged review, then allows owner download', async () => {
    const owner = await makeUser('owner'); const data = Buffer.from('%PDF-1.4 fake kyc bytes');
    const create = await post('/api/v1/storage/uploads', owner, { purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: data.length }).expect(201);
    const objectId = create.body.objectId;
    const up = await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${objectId}`).set('Cookie', `gs_session_dev=${owner.token}`).set('X-Storage-Token', create.body.token).set('Content-Type', 'application/pdf').send(data).expect(200);
    expect(up.body.state).toBe('QUARANTINED');
    await post(`/api/v1/storage/objects/${objectId}/download-url`, owner).expect(400);

    const reviewer = await makeUser('reviewer');
    await post(`/api/v1/storage/objects/${objectId}/review`, reviewer, { decision: 'approve', reason: 'document readable' }).expect(403);
    await grantReviewer(reviewer, false);
    const noStep = await post(`/api/v1/storage/objects/${objectId}/review`, reviewer, { decision: 'approve', reason: 'document readable' }).expect(403);
    expect(noStep.body.code).toBe('STEP_UP_REQUIRED');
    await grantReviewer(reviewer, true);
    const reviewDl = await post(`/api/v1/storage/objects/${objectId}/review-download-url`, reviewer).expect(201);
    const reviewBytes = await request(app.getHttpServer()).get(reviewDl.body.downloadUrl).expect(200);
    expect(Buffer.from(reviewBytes.body).equals(data)).toBe(true);
    const approved = await post(`/api/v1/storage/objects/${objectId}/review`, reviewer, { decision: 'approve', reason: 'document readable' }).expect(201);
    expect(approved.body.state).toBe('UPLOADED');

    const url = await post(`/api/v1/storage/objects/${objectId}/download-url`, owner).expect(201);
    const dl = await request(app.getHttpServer()).get(url.body.downloadUrl).expect(200);
    expect(Buffer.from(dl.body).equals(data)).toBe(true);
    const other = await makeUser('other');
    await post(`/api/v1/storage/objects/${objectId}/download-url`, other).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/storage/downloads/${objectId}?token=bad`).expect(403);
  });
  it('serializes overlapping uploads of one object and keeps bytes consistent with metadata', async () => {
    const owner = await makeUser('upload-race');
    const other = await makeUser('upload-other');
    const prefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const firstBytes = Buffer.concat([prefix, Buffer.from('first-image')]);
    const secondBytes = Buffer.concat([prefix, Buffer.from('other-image')]);
    const create = await post('/api/v1/storage/uploads', owner, { purpose: 'profile-avatar', contentType: 'image/png', sizeBytes: firstBytes.length }).expect(201);
    const objectId = create.body.objectId as string;
    const upload = (user: typeof owner, data: Buffer) => request(app.getHttpServer()).put(`/api/v1/storage/uploads/${objectId}`)
      .set('Cookie', `gs_session_dev=${user.token}`).set('X-Storage-Token', create.body.token).set('Content-Type', 'image/png').send(data);
    // A valid upload token does not grant another user access to the row.
    await upload(other, firstBytes).expect(404);
    const holder = new pg.Client({ connectionString: u.runtime });
    await holder.connect();
    let first: Promise<any> | undefined;
    let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.user_id',$1,true)", [owner.userId]);
      await holder.query("SELECT set_config('app.auth_version','1',true)");
      await holder.query("SELECT set_config('app.is_super','false',true)");
      await holder.query('SELECT id FROM "StorageObject" WHERE id=$1 FOR UPDATE', [objectId]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      first = upload(owner, firstBytes).then((res: any) => res);
      second = upload(owner, secondBytes).then((res: any) => res);
      const deadline = Date.now() + 4000;
      let blocked = 0;
      while (Date.now() < deadline) {
        const waiting = await holder.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE state='active' AND wait_event_type='Lock' AND pid <> $1 AND query LIKE '%StorageObject%'`, [holderPid]);
        blocked = waiting.rows[0].n;
        if (blocked >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(blocked).toBe(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const [a, b] = await Promise.all([first!, second!]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const winner = a.status === 200 ? firstBytes : secondBytes;
    expect((a.status === 400 ? a : b).body.code).toBe('OBJECT_NOT_PENDING');
    const metadata = await asSuper(u.privileged, c => c.query('SELECT state, sha256, "sizeBytes" FROM "StorageObject" WHERE id=$1', [objectId]));
    expect(metadata.rows[0]).toMatchObject({ state: 'UPLOADED', sha256: createHash('sha256').update(winner).digest('hex'), sizeBytes: String(winner.length) });
    const url = await post(`/api/v1/storage/objects/${objectId}/download-url`, owner).expect(201);
    const downloaded = await request(app.getHttpServer()).get(url.body.downloadUrl).expect(200);
    expect(Buffer.from(downloaded.body).equals(winner)).toBe(true);
  });
  it('denies self-review and rejects magic-byte mismatch', async () => {
    const owner = await makeUser('self'); await grantReviewer(owner, true);
    const data = Buffer.from('%PDF-1.4 fake kyc bytes');
    const create = await post('/api/v1/storage/uploads', owner, { purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: data.length }).expect(201);
    await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${create.body.objectId}`).set('Cookie', `gs_session_dev=${owner.token}`).set('X-Storage-Token', create.body.token).send(data).expect(200);
    const self = await post(`/api/v1/storage/objects/${create.body.objectId}/review`, owner, { decision: 'approve', reason: 'self approval attempt' }).expect(403);
    expect(self.body.code).toBe('SELF_REVIEW_DENIED');

    const bad = await makeUser('magic');
    const html = Buffer.from('<html>not a pdf</html>');
    const c2 = await post('/api/v1/storage/uploads', bad, { purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: html.length }).expect(201);
    const mismatch = await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${c2.body.objectId}`).set('Cookie', `gs_session_dev=${bad.token}`).set('X-Storage-Token', c2.body.token).set('Content-Type', 'application/pdf').send(html).expect(400);
    expect(mismatch.body.code).toBe('CONTENT_TYPE_MISMATCH');
  });
  it('rejects disallowed purpose/content-type and size mismatch', async () => {
    const u1 = await makeUser('bad');
    await post('/api/v1/storage/uploads', u1, { purpose: 'kyc-document', contentType: 'text/html', sizeBytes: 10 }).expect(400);
    const create = await post('/api/v1/storage/uploads', u1, { purpose: 'kyc-document', contentType: 'application/pdf', sizeBytes: 5 }).expect(201);
    await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${create.body.objectId}`).set('Cookie', `gs_session_dev=${u1.token}`).set('X-Storage-Token', create.body.token).send(Buffer.from('toolarge')).expect(400);
  });
});
