import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { urls, asSuper, asUser } from './helpers';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
let bdCountryId: string;
let lkCountryId: string;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `kyc-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `KYC ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }

async function grantReviewer(user: { userId: string; sessionId: string }, countryId: string, opts: { permission?: boolean; stepUp?: boolean; scope?: boolean } = {}) {
  const { permission = true, stepUp = true, scope = true } = opts;
  await asSuper(u.privileged, async c => {
    if (permission) {
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), 'kyc:case:review', 'kyc', 'case:review', 'critical']);
      const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `kyc-reviewer-${randomUUID()}`, 'KYC Reviewer']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
      await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    }
    if (scope) await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
    if (stepUp) await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]);
  });
}
async function makeStorageObject(ownerId: string, state: 'UPLOADED' | 'QUARANTINED' | 'PENDING_UPLOAD' = 'UPLOADED', purpose = 'kyc-document') {
  const id = randomUUID(); const hash = createHash('sha256').update(`kyc-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, purpose, `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, state, state !== 'PENDING_UPLOAD', 'local-dev-aes-256-gcm']);
  });
  return { id, hash };
}
async function createSubmittedCase(user: { userId: string; token: string; csrf: string }, subjectType: 'VENDOR' | 'RIDER' = 'VENDOR', countryId = bdCountryId) {
  const created = await post('/api/v1/kyc/cases', user, { subjectType, countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const caseId = created.body.caseId as string;
  const doc = await makeStorageObject(user.userId);
  await post(`/api/v1/kyc/cases/${caseId}/documents`, user, { storageObjectId: doc.id, documentType: 'NID_FRONT' }).expect(201);
  const submitted = await post(`/api/v1/kyc/cases/${caseId}/submit`, user, { version: 1 }).expect(201);
  return { caseId, doc, version: submitted.body.version as number };
}
const futureExpiry = () => new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  bdCountryId = await asSuper(u.privileged, async c => {
    const r = await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE']);
    return r.rows[0].id as string;
  });
  lkCountryId = await asSuper(u.privileged, async c => {
    const r = await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'LK', 'Sri Lanka', 'LKR', '+94', 'Asia/Colombo', 'ACTIVE']);
    return r.rows[0].id as string;
  });
});
afterAll(async () => { if (app) await app.close(); });

describe('KYC case foundation API and database guards', () => {
  it('runs the vendor lifecycle with scoped step-up review, eligibility, document access, audit and outbox', async () => {
    const applicant = await makeUser('vendor'); const reviewer = await makeUser('reviewer');
    await grantReviewer(reviewer, bdCountryId);
    const created = await post('/api/v1/kyc/cases', applicant, { subjectType: 'VENDOR', countryId: bdCountryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
    const caseId = created.body.caseId as string;
    expect(created.body.status).toBe('DRAFT');
    const duplicateCreate = await post('/api/v1/kyc/cases', applicant, { subjectType: 'VENDOR', countryId: bdCountryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
    expect(duplicateCreate.body.caseId).toBe(caseId); expect(duplicateCreate.body.duplicate).toBe(true);

    await post(`/api/v1/kyc/cases/${caseId}/submit`, applicant, { version: 1 }).expect(400);
    const doc = await makeStorageObject(applicant.userId);
    const linked = await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: doc.id, documentType: 'NID_FRONT' }).expect(201);
    const duplicateLink = await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: doc.id, documentType: 'NID_FRONT' }).expect(201);
    expect(duplicateLink.body.documentId).toBe(linked.body.documentId);
    await post(`/api/v1/kyc/cases/${caseId}/submit`, applicant, { version: 1 }).expect(201);

    const queue = await get(`/api/v1/kyc/admin/cases?countryId=${bdCountryId}&status=SUBMITTED`, reviewer).expect(200);
    expect(queue.body.items.some((x: any) => x.id === caseId)).toBe(true);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: 'start-review-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    const approved = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: 'approve-case-1', decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: futureExpiry() }).expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const eligibility = await get(`/api/v1/kyc/eligibility?subjectType=VENDOR&countryId=${bdCountryId}`, applicant).expect(200);
    expect(eligibility.body.eligible).toBe(true); expect(eligibility.body.caseId).toBe(caseId);
    const own = await get(`/api/v1/kyc/cases/${caseId}`, applicant).expect(200);
    expect(own.body.status).toBe('APPROVED'); expect(own.body.reviews.length).toBe(2);
    const access = await post(`/api/v1/kyc/cases/${caseId}/documents/${linked.body.documentId}/access`, reviewer).expect(201);
    expect(access.body.expiresIn).toBe(60); expect(access.body.downloadUrl).toContain('/api/v1/storage/downloads/');

    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid OR ("resourceType"='KycDocument' AND "scopeSnapshot"->>'caseId'=$2::text)`, [caseId, caseId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['kyc.case.created', 'kyc.case.submitted', 'kyc.case.approve', 'kyc.document.access']));
    const events = await asSuper(u.privileged, async c => c.query(`SELECT "eventType" FROM "OutboxEvent" WHERE "aggregateId"=$1`, [caseId]));
    expect(events.rows.map((r: any) => r.eventType)).toEqual(expect.arrayContaining(['kyc.case.created', 'kyc.case.submitted', 'kyc.case.reviewed']));
  });

  it('enforces permission, step-up, geographic scope, self-review denial and self-service subject limits', async () => {
    const applicant = await makeUser('self'); const { caseId, version } = await createSubmittedCase(applicant);
    const noPerm = await makeUser('noperm');
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, noPerm, { version, commandKey: 'no-perm-key', decision: 'START_REVIEW', reason: 'attempt review' }).expect(403);
    const noStep = await makeUser('nostep'); await grantReviewer(noStep, bdCountryId, { stepUp: false });
    const stepDenied = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, noStep, { version, commandKey: 'no-step-key', decision: 'START_REVIEW', reason: 'attempt review' }).expect(403);
    expect(stepDenied.body.code).toBe('STEP_UP_REQUIRED');
    const crossScope = await makeUser('cross'); await grantReviewer(crossScope, lkCountryId);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, crossScope, { version, commandKey: 'cross-scope-key', decision: 'START_REVIEW', reason: 'attempt review' }).expect(404);
    await get(`/api/v1/kyc/admin/cases?countryId=${bdCountryId}`, crossScope).expect(404);

    await grantReviewer(applicant, bdCountryId);
    const self = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, applicant, { version, commandKey: 'self-review-key', decision: 'START_REVIEW', reason: 'self approval attempt' }).expect(403);
    expect(self.body.code).toBe('SELF_REVIEW_DENIED');
    await post('/api/v1/kyc/cases', applicant, { subjectType: 'ADMIN', countryId: bdCountryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(400);
    await post('/api/v1/kyc/cases', applicant, { subjectType: 'RIDER', countryId: bdCountryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: false }).expect(400);
  });

  it('deduplicates review commands and rejects payload conflicts, stale versions and skipped transitions', async () => {
    const applicant = await makeUser('idem'); const reviewer = await makeUser('idem-reviewer'); await grantReviewer(reviewer, bdCountryId);
    const { caseId, version } = await createSubmittedCase(applicant);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'approve-too-early', decision: 'APPROVE', reason: 'skip start review', expiresAt: futureExpiry() }).expect(409);
    const start = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'start-idem-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    const duplicate = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'start-idem-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    expect(duplicate.body.duplicate).toBe(true); expect(duplicate.body.reviewId).toBe(start.body.reviewId);
    const conflict = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'start-idem-1', decision: 'START_REVIEW', reason: 'different payload' }).expect(409);
    expect(conflict.body.code).toBe('KYC_IDEMPOTENCY_CONFLICT');
    const stale = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'stale-version-key', decision: 'APPROVE', reason: 'stale version attempt', expiresAt: futureExpiry() }).expect(409);
    expect(stale.body.code).toBe('KYC_VERSION_CONFLICT');
  });

  it('supports more-information resubmission, approval expiry and revocation without deleting history', async () => {
    const applicant = await makeUser('renew'); const reviewer = await makeUser('renew-reviewer'); await grantReviewer(reviewer, bdCountryId);
    const { caseId, version } = await createSubmittedCase(applicant, 'RIDER');
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'start-renew-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: version + 1, commandKey: 'more-info-renew-1', decision: 'REQUEST_MORE_INFORMATION', reason: 'vehicle registration needed' }).expect(201);
    const doc2 = await makeStorageObject(applicant.userId);
    await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: doc2.id, documentType: 'VEHICLE_REGISTRATION' }).expect(201);
    await post(`/api/v1/kyc/cases/${caseId}/submit`, applicant, { version: version + 2 }).expect(201);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: version + 3, commandKey: 'start-renew-2', decision: 'START_REVIEW', reason: 'review supplemental evidence' }).expect(201);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: version + 4, commandKey: 'approve-past-expiry', decision: 'APPROVE', reason: 'past expiry attempt', expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: version + 4, commandKey: 'approve-renew-1', decision: 'APPROVE', reason: 'evidence now complete', expiresAt: futureExpiry() }).expect(201);
    expect((await get(`/api/v1/kyc/eligibility?subjectType=RIDER&countryId=${bdCountryId}`, applicant).expect(200)).body.eligible).toBe(true);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: version + 5, commandKey: 'revoke-renew-1', decision: 'REVOKE', reason: 'policy violation found' }).expect(201);
    expect((await get(`/api/v1/kyc/eligibility?subjectType=RIDER&countryId=${bdCountryId}`, applicant).expect(200)).body.eligible).toBe(false);
    const own = await get(`/api/v1/kyc/cases/${caseId}`, applicant).expect(200);
    expect(own.body.status).toBe('REVOKED'); expect(own.body.reviews.length).toBe(5);
  });

  it('rejects unready/foreign/non-KYC evidence and expired documents at approval', async () => {
    const applicant = await makeUser('evidence'); const reviewer = await makeUser('evidence-reviewer'); await grantReviewer(reviewer, bdCountryId);
    const created = await post('/api/v1/kyc/cases', applicant, { subjectType: 'VENDOR', countryId: bdCountryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
    const caseId = created.body.caseId as string;
    const quarantined = await makeStorageObject(applicant.userId, 'QUARANTINED');
    await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: quarantined.id, documentType: 'NID_FRONT' }).expect(409);
    const pending = await makeStorageObject(applicant.userId, 'PENDING_UPLOAD');
    await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: pending.id, documentType: 'NID_FRONT' }).expect(409);
    const other = await makeUser('other-owner'); const foreign = await makeStorageObject(other.userId);
    await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: foreign.id, documentType: 'NID_FRONT' }).expect(404);
    const avatar = await makeStorageObject(applicant.userId, 'UPLOADED', 'profile-avatar');
    await post(`/api/v1/kyc/cases/${caseId}/documents`, applicant, { storageObjectId: avatar.id, documentType: 'PROFILE_PHOTO' }).expect(404);

    const expiredDoc = await makeStorageObject(applicant.userId);
    await asSuper(u.privileged, async c => {
      await c.query(`INSERT INTO "KycDocument"(id,"caseId","storageObjectId","documentType","contentHash","expiresAt","linkedByUserId") VALUES ($1,$2,$3,$4,$5,now()-interval '1 day',$6)`, [randomUUID(), caseId, expiredDoc.id, 'NID_FRONT', expiredDoc.hash, applicant.userId]);
    });
    await post(`/api/v1/kyc/cases/${caseId}/submit`, applicant, { version: 1 }).expect(201);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: 'start-expired-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    const expired = await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: 'approve-expired-1', decision: 'APPROVE', reason: 'expired evidence attempt', expiresAt: futureExpiry() }).expect(409);
    expect(expired.body.code).toBe('KYC_DOCUMENT_EXPIRED');
  });

  it('enforces database append-only, review-required, self-review and linked-storage guards', async () => {
    const applicant = await makeUser('dbguard'); const reviewer = await makeUser('dbguard-reviewer'); await grantReviewer(reviewer, bdCountryId);
    const { caseId, doc, version } = await createSubmittedCase(applicant);
    await expect(asUser(u.runtime, applicant.userId, c => c.query(`UPDATE "KycCase" SET status='APPROVED' WHERE id=$1`, [caseId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "KycCase" SET status='UNDER_REVIEW', version=version+1 WHERE id=$1`, [caseId]))).rejects.toThrow(/kyc_review_required/);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "KycReview"(id,"caseId","reviewerUserId","commandKey","payloadHash",decision,"fromStatus","toStatus",reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), caseId, applicant.userId, 'self-db-key', 'a'.repeat(64), 'START_REVIEW', 'SUBMITTED', 'UNDER_REVIEW', 'self review attempt']))).rejects.toThrow(/kyc_self_review_denied/);
    await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version, commandKey: 'start-dbguard-1', decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "KycReview" SET reason=$1 WHERE "caseId"=$2`, ['edited', caseId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "KycDocument" WHERE "caseId"=$1`, [caseId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "StorageObject" SET state='DELETED' WHERE id=$1`, [doc.id]))).rejects.toThrow(/kyc_linked_storage_state_locked/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "StorageObject" WHERE id=$1`, [doc.id]))).rejects.toThrow(/permission denied|kyc_linked_storage_delete_denied/);
  });

  it('isolates runtime reads to the subject and hides foreign cases', async () => {
    const owner = await makeUser('rls-owner'); const stranger = await makeUser('rls-stranger');
    const { caseId } = await createSubmittedCase(owner);
    const ownRows = await asUser(u.runtime, owner.userId, c => c.query(`SELECT id FROM "KycCase" WHERE id=$1`, [caseId]));
    expect(ownRows.rowCount).toBe(1);
    const foreignRows = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "KycCase" WHERE id=$1`, [caseId]));
    expect(foreignRows.rowCount).toBe(0);
    await get(`/api/v1/kyc/cases/${caseId}`, stranger).expect(404);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`INSERT INTO "KycCase"(id,"subjectUserId","subjectType","countryId","policyVersion","consentVersion","consentedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now(),now())`, [randomUUID(), stranger.userId, 'VENDOR', bdCountryId, 'kyc-v1', 'consent-v1']))).rejects.toThrow(/permission denied/);
  });
});
