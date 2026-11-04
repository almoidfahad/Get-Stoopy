import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { urls, asSuper } from './helpers';

const u = urls();
const origin = 'http://localhost:3000';
let app: any;
let bd: string;
let lk: string;

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

async function makeUser(label: string) {
  const userId = randomUUID();
  const token = `risk-api-${label}-${randomUUID()}`;
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Risk API ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, sha(token)]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}

type Actor = Awaited<ReturnType<typeof makeUser>>;

async function grant(actor: Actor, countryId: string, opts: { permission?: boolean; scope?: boolean; stepUp?: boolean } = {}) {
  const { permission = true, scope = true, stepUp = true } = opts;
  await asSuper(u.privileged, async c => {
    if (permission) {
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,'risk:case:review','risk','case:review','critical') ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID()]);
      const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,'Risk Reviewer') RETURNING id`, [randomUUID(), `risk-reviewer-${randomUUID()}`]);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
      await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), actor.userId, role.rows[0].id, actor.userId]);
    }
    if (scope) await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,'COUNTRY',$3,$4)`, [randomUUID(), actor.userId, countryId, actor.userId]);
    if (stepUp) await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP',"stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [actor.sessionId]);
    await c.query(`UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=$1`, [actor.userId]);
    await c.query(`UPDATE "Session" SET "authVersion"="authVersion"+1 WHERE id=$1`, [actor.sessionId]);
  });
}

/** Cases are opened by the trusted foundation layer, never by this API. */
async function seedCase(subjectId: string, openedBy: string | null, countryId = bd) {
  const id = randomUUID();
  await asSuper(u.privileged, async c => {
    if (openedBy) await c.query("SELECT set_config('app.user_id',$1,true)", [openedBy]);
    await c.query(`INSERT INTO "RiskCase"(id,"countryId","subjectUserId",kind,"policyVersion","openedByUserId","updatedAt") VALUES ($1,$2,$3,'ORDER_ABUSE','risk-v1',$4,now())`, [id, countryId, subjectId, openedBy]);
    await c.query(`INSERT INTO "RiskSignal"(id,"caseId",code,weight,"evidenceHash") VALUES ($1,$2,'CONFIRMED_FAKE_ORDER_EVIDENCE',60,$3)`, [randomUUID(), id, sha(id)]);
    await c.query(`UPDATE "RiskCase" SET score=60,band='REVIEW',version=2,"updatedAt"=now() WHERE id=$1`, [id]);
  });
  return id;
}

const get = (path: string, a: Actor) => request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${a.token}`);
const post = (path: string, a: Actor, body: unknown) => request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${a.token}`).set('Origin', origin).set('X-CSRF-Token', a.csrf).send(body as object);
const reviewBody = (decision: 'CLEAR' | 'CONFIRM_FRAUD', extra: Record<string, unknown> = {}) => ({ expectedVersion: 2, decision, reason: 'Evidence reviewed against recorded signals', commandKey: `cmd-${randomUUID()}`, ...extra });

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin;
  process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15';
  process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64);
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  bd = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,'BD','Bangladesh','BDT','+880','Asia/Dhaka','ACTIVE') ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID()])).rows[0].id as string);
  lk = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,'LK','Sri Lanka','LKR','+94','Asia/Colombo','ACTIVE') ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID()])).rows[0].id as string);
});
afterAll(async () => { if (app) await app.close(); });

describe('risk review API', () => {
  it('requires permission, country scope and recent step-up', async () => {
    const subject = await makeUser('subject');
    const caseId = await seedCase(subject.userId, null);

    const noPerm = await makeUser('no-perm');
    await get(`/api/v1/risk/cases/${caseId}`, noPerm).expect(403);

    const noScope = await makeUser('no-scope');
    await grant(noScope, lk);
    const outOfScope = await get(`/api/v1/risk/cases/${caseId}`, noScope).expect(404);
    expect(outOfScope.body.code).toBe('RISK_CASE_NOT_FOUND');

    const noStepUp = await makeUser('no-stepup');
    await grant(noStepUp, bd, { stepUp: false });
    const denied = await get(`/api/v1/risk/cases/${caseId}`, noStepUp).expect(403);
    expect(denied.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('lists an aggregate queue without leaking subject identifiers', async () => {
    const reviewer = await makeUser('lister');
    await grant(reviewer, bd);
    const subject = await makeUser('listed-subject');
    const caseId = await seedCase(subject.userId, null);
    const res = await get('/api/v1/risk/cases', reviewer).query({ countryId: bd }).expect(200);
    expect(res.body.automatedEnforcement).toBe(false);
    const item = res.body.items.find((x: any) => x.id === caseId);
    expect(item).toBeDefined();
    expect(item.band).toBe('REVIEW');
    expect(item.subjectUserId).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(subject.userId);
  });

  it('audits the sensitive case read and returns the recorded evidence', async () => {
    const reviewer = await makeUser('reader');
    await grant(reviewer, bd);
    const subject = await makeUser('read-subject');
    const caseId = await seedCase(subject.userId, null);
    const res = await get(`/api/v1/risk/cases/${caseId}`, reviewer).expect(200);
    expect(res.body.signals).toHaveLength(1);
    expect(res.body.score).toBe(60);
    expect(res.body.automatedEnforcement).toBe(false);
    const audit = await asSuper(u.privileged, async c => (await c.query(`SELECT action FROM "AuditLog" WHERE "resourceType"='RiskCase' AND "resourceId"=$1 AND action='risk.case.read'`, [caseId])).rows);
    expect(audit.length).toBe(1);
  });

  it('rejects self-review and a non-independent reviewer', async () => {
    const opener = await makeUser('opener');
    await grant(opener, bd);
    const subject = await makeUser('own-subject');
    const opened = await seedCase(subject.userId, opener.userId);
    const notIndependent = await post(`/api/v1/risk/cases/${opened}/review`, opener, reviewBody('CLEAR')).expect(403);
    expect(notIndependent.body.code).toBe('RISK_REVIEW_NOT_INDEPENDENT');

    await grant(subject, bd);
    const selfReview = await post(`/api/v1/risk/cases/${opened}/review`, subject, reviewBody('CLEAR')).expect(403);
    expect(selfReview.body.code).toBe('RISK_SELF_REVIEW_DENIED');
  });

  it('records a finding idempotently, emits audit/outbox, and changes no money or permissions', async () => {
    const reviewer = await makeUser('decider');
    await grant(reviewer, bd);
    const subject = await makeUser('decided-subject');
    const caseId = await seedCase(subject.userId, null);
    const body = reviewBody('CONFIRM_FRAUD');

    const first = await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, body).expect(201);
    expect(first.body.status).toBe('CONFIRMED_FRAUD');
    expect(first.body.duplicate).toBe(false);
    expect(first.body.automatedEnforcement).toBe(false);

    const again = await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, body).expect(201);
    expect(again.body.duplicate).toBe(true);

    const conflict = await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, { ...body, reason: 'A different explanation entirely' }).expect(409);
    expect(conflict.body.code).toBe('RISK_IDEMPOTENCY_CONFLICT');

    const outbox = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "OutboxEvent" WHERE "aggregateType"='RiskCase' AND "aggregateId"=$1`, [caseId])).rows);
    expect(outbox).toHaveLength(1);
    const subjectRecord = await asSuper(u.privileged, async c => (await c.query(`SELECT status FROM "User" WHERE id=$1`, [subject.userId])).rows[0]);
    expect(subjectRecord.status).not.toBe('SUSPENDED');
    const roles = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "UserRole" WHERE "userId"=$1 AND "grantedBy"=$2`, [subject.userId, reviewer.userId])).rows);
    expect(roles).toHaveLength(0);
  });

  it('rejects stale versions, short reasons and terminal re-decision', async () => {
    const reviewer = await makeUser('version-check');
    await grant(reviewer, bd);
    const subject = await makeUser('version-subject');
    const caseId = await seedCase(subject.userId, null);

    await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, reviewBody('CLEAR', { expectedVersion: 1 })).expect(409);
    await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, reviewBody('CLEAR', { reason: 'short' })).expect(400);
    await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, reviewBody('CLEAR')).expect(201);
    const terminal = await post(`/api/v1/risk/cases/${caseId}/review`, reviewer, reviewBody('CONFIRM_FRAUD')).expect(409);
    expect(terminal.body.code).toBe('RISK_VERSION_OR_STATE');
  });

  it('exposes no case-creation or weight-setting endpoint', async () => {
    const reviewer = await makeUser('no-create');
    await grant(reviewer, bd);
    const subject = await makeUser('no-create-subject');
    await post('/api/v1/risk/cases', reviewer, { countryId: bd, subjectUserId: subject.userId, kind: 'ORDER_ABUSE', score: 100 }).expect(404);
  });
});
