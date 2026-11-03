import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { asSuper, asUser, urls } from './helpers';

const u = urls(); const origin = 'http://localhost:3000';
let app: any, countryId: string, otherCountryId: string, pool: pg.Pool, queue: Queue, redis: Redis;
const queueName = `gs-destination-test-${randomUUID()}`;
const testKey = 'f'.repeat(64);
async function makeUser(label: string) {
  const userId = randomUUID(), sessionId = randomUUID(), token = `destination-${label}-${randomUUID()}`;
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `TEST ONLY ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, createHash('sha256').update(token).digest('hex')]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: any, body: unknown = {}) { return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body); }
function get(path: string, user: any) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
async function stepUp(user: any) { await asSuper(u.privileged, c => c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP',"stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId])); }
async function grant(user: any, keys: string[], country = countryId) {
  await asSuper(u.privileged, async c => {
    const roleId = randomUUID(); await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,'TEST finance role')`, [roleId, `destination-role-${randomUUID()}`]);
    for (const key of keys) {
      const resource = key.split(':')[0]; const p = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,'critical') ON CONFLICT(key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1)]);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [roleId, p.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$2)`, [randomUUID(), user.userId, roleId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,'COUNTRY',$3,$2)`, [randomUUID(), user.userId, country]);
  }); await stepUp(user);
}
async function proofObject(ownerId: string) {
  const id = randomUUID(); await asSuper(u.privileged, c => c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,'kyc-document',$3,'application/pdf',100,$4,'UPLOADED',true,'local-dev-aes-256-gcm',now())`, [id, ownerId, `kyc-document/${ownerId}/${id}`, createHash('sha256').update(id).digest('hex')])); return id;
}
async function activeVendor(label: string) {
  const owner = await makeUser(label); const created = await post('/api/v1/parties/vendors', owner, { countryId, displayName: `TEST ${label}` }).expect(201); const vendorId = created.body.vendorId;
  const kycReviewer = await makeUser(`${label}-kyc`); await grant(kycReviewer, ['kyc:case:review']);
  const kyc = await post('/api/v1/kyc/cases', owner, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  await post(`/api/v1/kyc/cases/${kyc.body.caseId}/documents`, owner, { storageObjectId: await proofObject(owner.userId), documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kyc.body.caseId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kyc.body.caseId}/decision`, kycReviewer, { version: 2, commandKey: `start-${randomUUID()}`, decision: 'START_REVIEW', reason: 'begin test review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kyc.body.caseId}/decision`, kycReviewer, { version: 3, commandKey: `approve-${randomUUID()}`, decision: 'APPROVE', reason: 'synthetic evidence matches policy', expiresAt: new Date(Date.now() + 86400_000).toISOString() }).expect(201);
  const admin = await makeUser(`${label}-admin`); await grant(admin, ['vendor:profile:activate', 'vendor:profile:suspend']);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId: kyc.body.caseId, reason: 'approved synthetic vendor evidence' }).expect(201);
  await stepUp(owner); return { owner, vendorId, admin };
}
async function uploadProof(owner: any) {
  const data = Buffer.from(`%PDF-1.7\nTEST ONLY synthetic ownership proof ${randomUUID()}\n%%EOF`);
  const created = await post('/api/v1/storage/uploads', owner, { purpose: 'payout-destination-proof', contentType: 'application/pdf', sizeBytes: data.length }).expect(201);
  await request(app.getHttpServer()).put(created.body.uploadUrl).set('Cookie', `gs_session_dev=${owner.token}`).set('x-storage-token', created.body.token).set('Content-Type', 'application/pdf').send(data).expect(200);
  const reviewer = await makeUser('proof-reviewer'); await grant(reviewer, ['storage:kyc:review']);
  await post(`/api/v1/storage/objects/${created.body.objectId}/review`, owner, { decision: 'approve', reason: 'self approval must fail' }).expect(403);
  await post(`/api/v1/storage/objects/${created.body.objectId}/review`, reviewer, { decision: 'approve', reason: 'synthetic document independently reviewed' }).expect(201);
  return created.body.objectId as string;
}
function input(proof: string, account = '000123456789') { return { countryId, currency: 'BDT', rail: 'BANK', accountHolderName: 'TEST ONLY Vendor', accountNumber: account, institutionName: 'TEST ONLY Bank', proofStorageObjectId: proof, commandKey: `destination-${randomUUID()}` }; }
function review(decision: 'VERIFY' | 'REJECT' = 'VERIFY') { return { expectedVersion: 1, decision, verificationReference: `trusted-test-record-${randomUUID()}`, reason: 'synthetic ownership evidence matches trusted records', commandKey: `review-${randomUUID()}` }; }
async function drainOutbox() { for (let i = 0; i < 25; i++) { const r = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(),"leaseToken"=NULL,"leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`); if (!r.rowCount) return; await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName }); } }
beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`; process.env['PAYOUT_DESTINATION_ENCRYPTION_KEY'] = testKey;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`SELECT id FROM "Country" WHERE iso2='BD'`)).rows[0].id);
  otherCountryId = await asSuper(u.privileged, async c => (await c.query(`SELECT id FROM "Country" WHERE iso2='LK'`)).rows[0].id);
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 }); const parsed = new URL(process.env['REDIS_URL']!);
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null }); queue = new Queue(queueName, { connection: redis }); await drainOutbox();
});
afterAll(async () => { await drainOutbox(); if (queue) { await queue.obliterate({ force: true }); await queue.close(); } if (redis) await redis.quit(); if (pool) await pool.end(); if (app) await app.close(); });

describe('encrypted vendor payout destinations and independent review', () => {
  it('requires owner step-up, active KYC and independently reviewed proof; encrypts details and replays exactly', async () => {
    const { owner, vendorId } = await activeVendor('destination-owner'); const stranger = await makeUser('stranger'); const proof = await uploadProof(owner); const body = input(proof);
    await post(`/api/v1/vendors/${vendorId}/payout-destinations`, stranger, body).expect(404);
    await asSuper(u.privileged, c => c.query(`UPDATE "Session" SET "assuranceLevel"='MFA',"stepUpExpiresAt"=NULL WHERE id=$1`, [owner.sessionId]));
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, body).expect(403)).body.code).toBe('STEP_UP_REQUIRED'); await stepUp(owner);
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, { ...body, currency: 'USD' }).expect(400)).body.code).toBe('DESTINATION_COUNTRY_CURRENCY_MISMATCH');
    const created = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, body).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING_REVIEW', payoutEnabled: false, moneyMoved: false, displayMask: '••••6789' });
    expect(JSON.stringify(created.body)).not.toContain(body.accountNumber); expect(JSON.stringify(created.body)).not.toContain(body.accountHolderName);
    const replay = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, body).expect(201); expect(replay.body.destinationId).toBe(created.body.destinationId); expect(replay.body.duplicate).toBe(true);
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, { ...body, institutionName: 'Changed TEST bank' }).expect(409)).body.code).toBe('DESTINATION_IDEMPOTENCY_CONFLICT');
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, { ...body, commandKey: `other-${randomUUID()}`, proofStorageObjectId: await uploadProof(owner) }).expect(409)).body.code).toBe('DESTINATION_ALREADY_EXISTS');
    const stored = await asSuper(u.privileged, c => c.query(`SELECT encode("detailsEnvelope",'escape') AS envelope FROM "PayoutDestination" WHERE id=$1`, [created.body.destinationId]));
    expect(stored.rows[0].envelope).not.toContain(body.accountNumber); expect(stored.rows[0].envelope).not.toContain(body.accountHolderName);
    const events = await asSuper(u.privileged, c => c.query(`SELECT payload::text AS p FROM "OutboxEvent" WHERE "aggregateId"=$1`, [created.body.destinationId])); expect(events.rows[0].p).not.toContain(body.accountNumber);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "PayoutDestination" WHERE id=$1`, [created.body.destinationId]))).resolves.toMatchObject({ rowCount: 0 });
    await expect(asUser(u.runtime, owner.userId, c => c.query(`SELECT id FROM "PayoutDestination" WHERE id=$1`, [created.body.destinationId]))).resolves.toMatchObject({ rowCount: 1 });
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "PayoutDestination" SET "displayMask"='changed' WHERE id=$1`, [created.body.destinationId]))).rejects.toThrow(/payout_destination_immutable|permission denied/);
  });
  it('enforces scoped checker review, cooldown, retirement and append-only history without a payout', async () => {
    const { owner, vendorId } = await activeVendor('destination-review'); const d = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(await uploadProof(owner))).expect(201);
    const id = d.body.destinationId; const reviewer = await makeUser('finance-reviewer'); await grant(reviewer, ['finance:payout-destination:review']); const cross = await makeUser('cross-reviewer'); await grant(cross, ['finance:payout-destination:review'], otherCountryId); const body = review();
    await get(`/api/v1/admin/payout-destinations?countryId=${countryId}`, owner).expect(403);
    await post(`/api/v1/admin/payout-destinations/${id}/review`, cross, body).expect(404);
    await grant(owner, ['finance:payout-destination:review']); expect((await post(`/api/v1/admin/payout-destinations/${id}/review`, owner, body).expect(403)).body.code).toBe('SELF_REVIEW_DENIED');
    await asSuper(u.privileged, c => c.query(`UPDATE "Session" SET "assuranceLevel"='MFA',"stepUpExpiresAt"=NULL WHERE id=$1`, [reviewer.sessionId]));
    expect((await post(`/api/v1/admin/payout-destinations/${id}/review`, reviewer, body).expect(403)).body.code).toBe('STEP_UP_REQUIRED'); await stepUp(reviewer);
    const verified = await post(`/api/v1/admin/payout-destinations/${id}/review`, reviewer, body).expect(201); expect(verified.body.status).toBe('VERIFIED'); expect(verified.body.payoutEnabled).toBe(false); expect(new Date(verified.body.eligibleAt).getTime()).toBeGreaterThan(Date.now());
    const replay = await post(`/api/v1/admin/payout-destinations/${id}/review`, reviewer, body).expect(201); expect(replay.body.duplicate).toBe(true);
    expect((await post(`/api/v1/admin/payout-destinations/${id}/review`, reviewer, { ...body, reason: 'different reason for replay' }).expect(409)).body.code).toBe('DESTINATION_IDEMPOTENCY_CONFLICT');
    const retire = { expectedVersion: 2, commandKey: `retire-${randomUUID()}`, reason: 'owner requested destination removal' };
    const retired = await post(`/api/v1/vendors/${vendorId}/payout-destinations/${id}/retire`, owner, retire).expect(201); expect(retired.body.status).toBe('RETIRED'); expect(retired.body.eligibleAt).toBeNull();
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations/${id}/retire`, owner, retire).expect(201)).body.duplicate).toBe(true);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "PayoutDestinationReview" WHERE "destinationId"=$1`, [id]))).rejects.toThrow(/permission denied|append_only/);
    const history = await asSuper(u.privileged, c => c.query(`SELECT decision FROM "PayoutDestinationReview" WHERE "destinationId"=$1 ORDER BY "destinationVersion"`, [id])); expect(history.rows.map((r: any) => r.decision)).toEqual(['VERIFY', 'RETIRE']);
  });
  it('serializes competing reviews and atomically retires the old destination on replacement', async () => {
    const { owner, vendorId } = await activeVendor('destination-replace'); const first = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(await uploadProof(owner), '000111111111')).expect(201);
    const reviewer = await makeUser('replacement-reviewer'); await grant(reviewer, ['finance:payout-destination:review']);
    const results = await Promise.all([post(`/api/v1/admin/payout-destinations/${first.body.destinationId}/review`, reviewer, review()), post(`/api/v1/admin/payout-destinations/${first.body.destinationId}/review`, reviewer, review())]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const second = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(await uploadProof(owner), '000222222222')).expect(201);
    await post(`/api/v1/admin/payout-destinations/${second.body.destinationId}/review`, reviewer, review()).expect(201);
    const rows = await asSuper(u.privileged, c => c.query(`SELECT id,status FROM "PayoutDestination" WHERE "vendorId"=$1 ORDER BY "createdAt"`, [vendorId]));
    expect(rows.rows.map((r: any) => r.status)).toEqual(['RETIRED', 'VERIFIED']);
    const count = await asSuper(u.privileged, c => c.query(`SELECT COUNT(*)::int AS n FROM "PayoutDestinationReview" WHERE "destinationId"=$1`, [first.body.destinationId])); expect(count.rows[0].n).toBe(2);
  });
  it('denies runtime writes and rejects a database review bypass at COMMIT', async () => {
    const { owner, vendorId } = await activeVendor('destination-db-guard'); const d = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(await uploadProof(owner))).expect(201);
    const id = d.body.destinationId;
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "PayoutDestination" SET status='VERIFIED' WHERE id=$1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, async c => {
      await c.query(`UPDATE "PayoutDestination" SET status='REJECTED',version=2,"reviewedAt"=now(),"reviewedByUserId"=$2,"verificationReference"='bypass-attempt',"reviewReason"='attempt without append-only review' WHERE id=$1`, [id, owner.userId]);
    })).rejects.toThrow(/independent_review_required|review_required/);
    const unchanged = await asSuper(u.privileged, c => c.query(`SELECT status,version FROM "PayoutDestination" WHERE id=$1`, [id])); expect(unchanged.rows[0]).toMatchObject({ status: 'PENDING_REVIEW', version: 1 });
    await expect(asUser(u.runtime, owner.userId, c => c.query(`SELECT id FROM "PayoutDestinationReview" WHERE "destinationId"=$1`, [id]))).resolves.toMatchObject({ rowCount: 0 });
  });
  it('rejects unverified proof and allows a terminal rejection without verification metadata', async () => {
    const { owner, vendorId } = await activeVendor('destination-reject'); const data = Buffer.from(`%PDF-1.7\nTEST ONLY ${randomUUID()}\n%%EOF`);
    const upload = await post('/api/v1/storage/uploads', owner, { purpose: 'payout-destination-proof', contentType: 'application/pdf', sizeBytes: data.length }).expect(201);
    await request(app.getHttpServer()).put(upload.body.uploadUrl).set('Cookie', `gs_session_dev=${owner.token}`).set('x-storage-token', upload.body.token).set('Content-Type', 'application/pdf').send(data).expect(200);
    expect((await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(upload.body.objectId)).expect(409)).body.code).toBe('DESTINATION_PROOF_REQUIRED');
    const reviewer = await makeUser('proof-rejector'); await grant(reviewer, ['storage:kyc:review']); await post(`/api/v1/storage/objects/${upload.body.objectId}/review`, reviewer, { decision: 'approve', reason: 'synthetic proof reviewed' }).expect(201);
    const d = await post(`/api/v1/vendors/${vendorId}/payout-destinations`, owner, input(upload.body.objectId)).expect(201);
    const finance = await makeUser('reject-reviewer'); await grant(finance, ['finance:payout-destination:review']);
    const rejected = await post(`/api/v1/admin/payout-destinations/${d.body.destinationId}/review`, finance, review('REJECT')).expect(201); expect(rejected.body.status).toBe('REJECTED'); expect(rejected.body.verifiedAt).toBeNull(); expect(rejected.body.eligibleAt).toBeNull();
    expect((await post(`/api/v1/admin/payout-destinations/${d.body.destinationId}/review`, finance, review()).expect(409)).body.code).toBe('DESTINATION_ALREADY_REVIEWED');
  });
});
