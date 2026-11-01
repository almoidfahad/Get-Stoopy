import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { urls, asSuper } from './helpers';
import { totp } from '../../packages/auth/src/totp';
const u = urls();
let app: any;
const origin = 'http://localhost:3000';
async function makeUser(label: string) {
  const userId = randomUUID(); const token = `sec-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query('INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())', [userId, `Security ${label}`]);
    await c.query('INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval \'1 hour\',now()+interval \'15 minutes\',1)', [randomUUID(), userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, u: { token: string; csrf: string }, body: unknown = {}) { return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${u.token}`).set('Origin', origin).set('X-CSRF-Token', u.csrf).send(body); }
beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
});
afterAll(async () => { if (app) await app.close(); });
describe('security step-up, recovery, sessions and emergency revocation', () => {
  it('enrolls TOTP, confirms, steps up, regenerates recovery codes and revokes other sessions', async () => {
    const u1 = await makeUser('enroll');
    const status = await request(app.getHttpServer()).get('/api/v1/auth/mfa').set('Cookie', `gs_session_dev=${u1.token}`).expect(200);
    expect(status.body.mfaState).toBe('NONE');
    const enroll = await post('/api/v1/auth/mfa/enroll', u1).expect(201);
    expect(enroll.body.otpauthUri).toContain('otpauth://totp/');
    const code = totp(enroll.body.secret);
    const confirm = await post('/api/v1/auth/mfa/confirm', u1, { code }).expect(201);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    const bad = await post('/api/v1/auth/mfa/step-up', u1, { code: '000000' }).expect(401);
    expect(bad.body.code).toBe('MFA_CODE_INVALID');
    const step = await post('/api/v1/auth/mfa/step-up', u1, { code: totp(enroll.body.secret, Date.now() + 30_000) }).expect(201);
    expect(step.body.stepUp).toBe(true);
    const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${u1.token}`).expect(200);
    expect(me.body.user.assurance).toBe('STEP_UP');
    const recovery = await post('/api/v1/auth/mfa/recovery-codes', u1).expect(201);
    expect(recovery.body.recoveryCodes).toHaveLength(10);
    const u2 = await makeUser('other-session');
    const sessions = await request(app.getHttpServer()).get('/api/v1/auth/sessions').set('Cookie', `gs_session_dev=${u1.token}`).expect(200);
    expect(sessions.body.length).toBe(1);
    const others = await post('/api/v1/auth/sessions/revoke-others', u1).expect(201);
    expect(others.body.revoked).toBe(0);
    const recoveryStep = await post('/api/v1/auth/mfa/step-up', u1, { recoveryCode: recovery.body.recoveryCodes[0] }).expect(201);
    expect(recoveryStep.body.stepUp).toBe(true);
    await post('/api/v1/auth/mfa/step-up', u1, { recoveryCode: recovery.body.recoveryCodes[0] }).expect(401);
  });
  it('emergency revocation invalidates target sessions and bumps authorization version', async () => {
    const admin = await makeUser('admin'); const target = await makeUser('target');
    await asSuper(u.privileged, async c => {
      const perm = await c.query('INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id', [randomUUID(), 'security:session:revoke', 'security', 'revoke', 'HIGH']);
      const role = await c.query('INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id', [randomUUID(), `security-admin-${randomUUID()}`, 'Security Admin']);
      await c.query('INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)', [role.rows[0].id, perm.rows[0].id]);
      await c.query('INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)', [randomUUID(), admin.userId, role.rows[0].id, admin.userId]);
    });
    const enroll = await post('/api/v1/auth/mfa/enroll', admin).expect(201);
    await post('/api/v1/auth/mfa/confirm', admin, { code: totp(enroll.body.secret) }).expect(201);
    await post('/api/v1/auth/mfa/step-up', admin, { code: totp(enroll.body.secret, Date.now() + 30_000) }).expect(201);
    const denied = await post('/api/v1/auth/emergency/revoke-user/' + target.userId, admin, { reason: 'incident drill' }).expect(201);
    expect(denied.body.revokedSessions).toBe(1);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${target.token}`).expect(401);
    const outbox = await asSuper(u.privileged, async c => c.query('SELECT "eventType" FROM "OutboxEvent" WHERE "aggregateId"=$1', [target.userId]));
    expect(outbox.rows.some(r => r.eventType === 'security.user.revoked')).toBe(true);
  });
  it('denies linking an unverified or foreign provider token', async () => {
    const u1 = await makeUser('link');
    const res = await post('/api/v1/auth/identities/link', u1, { idToken: 'not-a-jwt' }).expect(401);
    expect(res.body.code).toBe('OIDC_VERIFICATION_FAILED');
  });
});
