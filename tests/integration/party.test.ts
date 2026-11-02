import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, asUser } from './helpers';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
let bdCountryId: string;
let lkCountryId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-party-test-${randomUUID()}`;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `party-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Party ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
async function setStepUp(user: { sessionId: string }) {
  await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]); });
}
async function grantPartyAdmin(user: { userId: string; sessionId: string }, countryId: string, keys: string[], opts: { stepUp?: boolean; scope?: boolean } = {}) {
  const { stepUp = true, scope = true } = opts;
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `party-admin-${randomUUID()}`, 'Party Admin']);
    for (const key of keys) {
      const [resource, action] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'critical']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    if (scope) await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  if (stepUp) await setStepUp(user);
}
async function grantKycReviewer(user: { userId: string; sessionId: string }, countryId: string) {
  await asSuper(u.privileged, async c => {
    const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), 'kyc:case:review', 'kyc', 'case:review', 'critical']);
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `kyc-reviewer-${randomUUID()}`, 'KYC Reviewer']);
    await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`party-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return { id, hash };
}
async function createApprovedKyc(subject: { userId: string; token: string; csrf: string }, subjectType: 'VENDOR' | 'RIDER', countryId: string, expiresInMs = 30 * 24 * 3600_000) {
  const reviewer = await makeUser(`kyc-reviewer-${subjectType.toLowerCase()}`);
  await grantKycReviewer(reviewer, countryId);
  const created = await post('/api/v1/kyc/cases', subject, { subjectType, countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const caseId = created.body.caseId as string;
  const doc = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${caseId}/documents`, subject, { storageObjectId: doc.id, documentType: subjectType === 'VENDOR' ? 'TRADE_LICENSE' : 'NID_FRONT' }).expect(201);
  await post(`/api/v1/kyc/cases/${caseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: `start-${caseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: `approve-${caseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + expiresInMs).toISOString() }).expect(201);
  return caseId;
}
async function drainOutbox() {
  for (let i = 0; i < 25; i++) {
    const pending = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(), "leaseToken"=NULL, "leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`);
    if ((pending.rowCount ?? 0) === 0) return;
    await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName });
  }
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  bdCountryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  lkCountryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'LK', 'Sri Lanka', 'LKR', '+94', 'Asia/Colombo', 'ACTIVE'])).rows[0].id as string);
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();
});
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('party profiles, membership resolution and KYC-gated activation', () => {
  it('creates vendor drafts idempotently and keeps them out of session memberships until KYC-gated activation', async () => {
    const owner = await makeUser('vendor-owner');
    const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'Stoopy Vendor', legalName: 'Stoopy Vendor Ltd' }).expect(201);
    const vendorId = created.body.vendorId as string;
    expect(created.body.status).toBe('DRAFT');
    const duplicate = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'Stoopy Vendor' }).expect(201);
    expect(duplicate.body.vendorId).toBe(vendorId); expect(duplicate.body.duplicate).toBe(true);
    const mine = await get('/api/v1/parties/vendors/me', owner).expect(200);
    expect(mine.body[0].id).toBe(vendorId);
    const before = await get('/api/v1/auth/me', owner).expect(200);
    expect(before.body.vendorMemberships).toEqual([]);
    const memberships = await asSuper(u.privileged, async c => c.query(`SELECT role FROM "VendorMembership" WHERE "vendorId"=$1`, [vendorId]));
    expect(memberships.rows.map((r: any) => r.role)).toEqual(['OWNER']);
  });

  it('enforces permission, step-up, country scope, self-activation denial and approved KYC before vendor activation', async () => {
    const owner = await makeUser('activate-owner');
    const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'Activation Vendor' }).expect(201);
    const vendorId = created.body.vendorId as string;
    const kycCaseId = await createApprovedKyc(owner, 'VENDOR', bdCountryId);
    const noPerm = await makeUser('no-perm');
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, noPerm, { version: 1, kycCaseId, reason: 'attempt activation' }).expect(403);
    const noStep = await makeUser('no-step'); await grantPartyAdmin(noStep, bdCountryId, ['vendor:profile:activate'], { stepUp: false });
    const stepDenied = await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, noStep, { version: 1, kycCaseId, reason: 'attempt activation' }).expect(403);
    expect(stepDenied.body.code).toBe('STEP_UP_REQUIRED');
    const cross = await makeUser('cross-scope'); await grantPartyAdmin(cross, lkCountryId, ['vendor:profile:activate']);
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, cross, { version: 1, kycCaseId, reason: 'attempt activation' }).expect(404);
    await grantPartyAdmin(owner, bdCountryId, ['vendor:profile:activate']);
    const self = await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, owner, { version: 1, kycCaseId, reason: 'self activation attempt' }).expect(403);
    expect(self.body.code).toBe('SELF_ACTIVATION_DENIED');
    const admin = await makeUser('vendor-admin'); await grantPartyAdmin(admin, bdCountryId, ['vendor:profile:activate', 'vendor:profile:suspend']);
    const wrongKyc = await createApprovedKyc(await makeUser('other-subject'), 'VENDOR', bdCountryId);
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId: wrongKyc, reason: 'wrong subject attempt' }).expect(409);
    const activated = await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
    expect(activated.body.status).toBe('ACTIVE'); expect(activated.body.version).toBe(2);
    const after = await get('/api/v1/auth/me', owner).expect(200);
    expect(after.body.vendorMemberships).toHaveLength(1);
    expect(after.body.vendorMemberships[0]).toMatchObject({ vendorId, countryId: bdCountryId });
    expect(after.body.vendorMemberships[0].permissions).toContain('vendor:order:write');
    const stale = await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'stale version attempt' }).expect(409);
    expect(stale.body.code).toBe('PARTY_VERSION_CONFLICT');
    const suspended = await post(`/api/v1/parties/admin/vendors/${vendorId}/suspend`, admin, { version: 2, reason: 'policy investigation' }).expect(201);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect((await get('/api/v1/auth/me', owner).expect(200)).body.vendorMemberships).toEqual([]);
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 3, kycCaseId, reason: 'investigation cleared' }).expect(201);
    expect((await get('/api/v1/auth/me', owner).expect(200)).body.vendorMemberships).toHaveLength(1);
    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid`, [vendorId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['party.vendor.created', 'party.vendor.activated', 'party.vendor.suspended']));
    const events = await asSuper(u.privileged, async c => c.query(`SELECT "eventType" FROM "OutboxEvent" WHERE "aggregateId"=$1`, [vendorId]));
    expect(events.rows.map((r: any) => r.eventType)).toEqual(expect.arrayContaining(['party.vendor.created', 'party.vendor.activated', 'party.vendor.suspended']));
  });

  it('resolves vendor memberships only for unrevoked/unexpired members of active KYC-eligible vendors', async () => {
    const owner = await makeUser('membership-owner'); await setStepUp(owner);
    const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'Membership Vendor' }).expect(201);
    const vendorId = created.body.vendorId as string;
    const kycCaseId = await createApprovedKyc(owner, 'VENDOR', bdCountryId);
    const admin = await makeUser('membership-admin'); await grantPartyAdmin(admin, bdCountryId, ['vendor:profile:activate']);
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
    const staff = await makeUser('staff');
    const granted = await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: staff.userId, role: 'STAFF' }).expect(201);
    const staffMe = await get('/api/v1/auth/me', staff).expect(200);
    expect(staffMe.body.vendorMemberships).toHaveLength(1);
    expect(staffMe.body.vendorMemberships[0].permissions).toContain('vendor:order:read');
    expect(staffMe.body.vendorMemberships[0].permissions).not.toContain('vendor:catalog:write');
    const stranger = await makeUser('membership-stranger');
    await post(`/api/v1/parties/vendors/${vendorId}/memberships`, stranger, { userId: staff.userId, role: 'MANAGER' }).expect(404);
    await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: staff.userId, role: 'OWNER' }).expect(400);
    const list = await get(`/api/v1/parties/vendors/${vendorId}/memberships`, owner).expect(200);
    expect(list.body).toHaveLength(2);
    await post(`/api/v1/parties/vendors/${vendorId}/memberships/${granted.body.membershipId}/revoke`, owner).expect(201);
    expect((await get('/api/v1/auth/me', staff).expect(200)).body.vendorMemberships).toEqual([]);
    const ownerMembership = list.body.find((m: any) => m.role === 'OWNER');
    await post(`/api/v1/parties/vendors/${vendorId}/memberships/${ownerMembership.id}/revoke`, owner).expect(403);
    const expired = await makeUser('expired-member');
    const expiredGrant = await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: expired.userId, role: 'MANAGER', expiresAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
    expect((await get('/api/v1/auth/me', expired).expect(200)).body.vendorMemberships).toHaveLength(1);
    await asSuper(u.privileged, async c => { await c.query(`UPDATE "VendorMembership" SET "expiresAt"=now()-interval '1 second' WHERE id=$1`, [expiredGrant.body.membershipId]); });
    expect((await get('/api/v1/auth/me', expired).expect(200)).body.vendorMemberships).toEqual([]);
  });

  it('gates rider session eligibility on active profile plus approved unexpired rider KYC and supports suspension', async () => {
    const rider = await makeUser('rider');
    const created = await post('/api/v1/parties/riders', rider, { countryId: bdCountryId, vehicleType: 'MOTORBIKE' }).expect(201);
    const riderId = created.body.riderId as string;
    expect(created.body.status).toBe('DRAFT');
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBeNull();
    const kycCaseId = await createApprovedKyc(rider, 'RIDER', bdCountryId);
    const admin = await makeUser('rider-admin'); await grantPartyAdmin(admin, bdCountryId, ['rider:profile:activate', 'rider:profile:suspend']);
    const vendorKyc = await createApprovedKyc(rider, 'VENDOR', bdCountryId);
    await post(`/api/v1/parties/admin/riders/${riderId}/activate`, admin, { version: 1, kycCaseId: vendorKyc, reason: 'wrong subject type attempt' }).expect(409);
    await post(`/api/v1/parties/admin/riders/${riderId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved rider evidence' }).expect(201);
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBe(riderId);
    await post(`/api/v1/parties/admin/riders/${riderId}/suspend`, admin, { version: 2, reason: 'vehicle document issue' }).expect(201);
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBeNull();
    await post(`/api/v1/parties/admin/riders/${riderId}/activate`, admin, { version: 3, kycCaseId, reason: 'vehicle document restored' }).expect(201);
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBe(riderId);
    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid`, [riderId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['party.rider.created', 'party.rider.activated', 'party.rider.suspended']));
  });

  it('enforces database insert/update guards, RLS isolation and append-only party history', async () => {
    const owner = await makeUser('db-owner');
    const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'DB Guard Vendor' }).expect(201);
    const vendorId = created.body.vendorId as string;
    const rider = await makeUser('db-rider');
    const riderCreated = await post('/api/v1/parties/riders', rider, { countryId: bdCountryId, vehicleType: 'BICYCLE' }).expect(201);
    const riderId = riderCreated.body.riderId as string;
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "Vendor" SET status='ACTIVE', version=2 WHERE id=$1`, [vendorId]))).rejects.toThrow(/permission denied/);
    await expect(asUser(u.runtime, owner.userId, c => c.query(`INSERT INTO "RiderProfile"(id,"userId","countryId","vehicleType","updatedAt") VALUES ($1,$2,$3,$4,now())`, [randomUUID(), owner.userId, bdCountryId, 'CAR']))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Vendor" SET status='ACTIVE', version=2, "activatedAt"=now(), "activatedByUserId"=$2 WHERE id=$1`, [vendorId, owner.userId]))).rejects.toThrow(/party_activation_metadata_required|party_kyc_approval_required/);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "KycCase"(id,"subjectUserId","subjectType","countryId",status,"policyVersion","consentVersion","consentedAt","expiresAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now()+interval '30 days',now())`, [randomUUID(), owner.userId, 'VENDOR', bdCountryId, 'APPROVED', 'kyc-v1', 'consent-v1']))).rejects.toThrow(/kyc_case_must_start_draft/);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "VendorMembership"(id,"vendorId","userId",role,"grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), vendorId, rider.userId, 'OWNER', owner.userId]))).rejects.toThrow(/membership_owner_mismatch/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "Vendor" WHERE id=$1`, [vendorId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "RiderProfile" WHERE id=$1`, [riderId]))).rejects.toThrow(/permission denied/);
    const ownVendor = await asUser(u.runtime, owner.userId, c => c.query(`SELECT id FROM "Vendor" WHERE id=$1`, [vendorId]));
    expect(ownVendor.rowCount).toBe(1);
    const stranger = await makeUser('db-stranger');
    const foreignVendor = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "Vendor" WHERE id=$1`, [vendorId]));
    expect(foreignVendor.rowCount).toBe(0);
    const ownRider = await asUser(u.runtime, rider.userId, c => c.query(`SELECT id FROM "RiderProfile" WHERE id=$1`, [riderId]));
    expect(ownRider.rowCount).toBe(1);
    const foreignRider = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "RiderProfile" WHERE id=$1`, [riderId]));
    expect(foreignRider.rowCount).toBe(0);
  });

  it('fails closed when linked KYC is revoked or expired after activation', async () => {
    const owner = await makeUser('expiry-owner');
    const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: 'Expiry Vendor' }).expect(201);
    const vendorId = created.body.vendorId as string;
    const kycCaseId = await createApprovedKyc(owner, 'VENDOR', bdCountryId);
    const admin = await makeUser('expiry-admin'); await grantPartyAdmin(admin, bdCountryId, ['vendor:profile:activate']);
    const reviewer = await makeUser('expiry-reviewer'); await grantKycReviewer(reviewer, bdCountryId);
    await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
    expect((await get('/api/v1/auth/me', owner).expect(200)).body.vendorMemberships).toHaveLength(1);
    await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 4, commandKey: `revoke-${kycCaseId}`, decision: 'REVOKE', reason: 'policy violation found' }).expect(201);
    expect((await get('/api/v1/auth/me', owner).expect(200)).body.vendorMemberships).toEqual([]);
    const rider = await makeUser('expiry-rider');
    const riderCreated = await post('/api/v1/parties/riders', rider, { countryId: bdCountryId, vehicleType: 'CAR' }).expect(201);
    const riderId = riderCreated.body.riderId as string;
    const riderKyc = await createApprovedKyc(rider, 'RIDER', bdCountryId, 2_000);
    const riderAdmin = await makeUser('expiry-rider-admin'); await grantPartyAdmin(riderAdmin, bdCountryId, ['rider:profile:activate']);
    await post(`/api/v1/parties/admin/riders/${riderId}/activate`, riderAdmin, { version: 1, kycCaseId: riderKyc, reason: 'approved rider evidence' }).expect(201);
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBe(riderId);
    await new Promise(resolve => setTimeout(resolve, 2_500));
    expect((await get('/api/v1/auth/me', rider).expect(200)).body.riderId).toBeNull();
  });
});
