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
let countryId: string;
let cityId: string;
let zoneId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-serviceability-test-${randomUUID()}`;
let owner: any;
let stranger: any;
let rider: any;
let riderId: string;
let vendorId: string;
let storeId: string;
let serviceabilityAdmin: any;
let zoneAdmin: any;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `serviceability-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Serviceability ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function put(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).put(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
async function setStepUp(user: { sessionId: string }) {
  await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]); });
}
async function grantKeys(user: { userId: string; sessionId: string }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `serviceability-role-${randomUUID()}`, 'Serviceability Role']);
    for (const key of keys) {
      const [resource] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`serviceability-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return id;
}
async function approveKyc(subject: any, subjectType: 'VENDOR' | 'RIDER', reviewer: any) {
  const kyc = await post('/api/v1/kyc/cases', subject, { subjectType, countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const kycCaseId = kyc.body.caseId;
  const docId = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, subject, { storageObjectId: docId, documentType: subjectType === 'VENDOR' ? 'TRADE_LICENSE' : 'NID_FRONT' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  return kycCaseId as string;
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
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `svc-reg-${randomUUID().slice(0, 8)}`, 'Serviceability', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `svc-dist-${randomUUID().slice(0, 8)}`, 'Serviceability', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `svc-city-${randomUUID().slice(0, 8)}`, 'Serviceability', 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
  zoneId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), cityId, `svc-zone-${randomUUID().slice(0, 8)}`, 'Pilot Zone'])).rows[0].id as string);
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();
  owner = await makeUser('owner'); stranger = await makeUser('stranger'); rider = await makeUser('rider');
  const kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate', 'rider:profile:activate']);
  const storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  serviceabilityAdmin = await makeUser('serviceability-admin'); await grantKeys(serviceabilityAdmin, ['catalog:store:serviceability:review']);
  zoneAdmin = await makeUser('zone-admin'); await grantKeys(zoneAdmin, ['rider:zone:grant']);
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Serviceability Vendor' }).expect(201);
  vendorId = vendor.body.vendorId;
  const vendorKyc = await approveKyc(owner, 'VENDOR', kycReviewer);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId: vendorKyc, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'Serviceability Store', slug: `svc-store-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  storeId = store.body.storeId;
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  const riderProfile = await post('/api/v1/parties/riders', rider, { countryId, vehicleType: 'MOTORBIKE' }).expect(201);
  riderId = riderProfile.body.riderId;
  const riderKyc = await approveKyc(rider, 'RIDER', kycReviewer);
  await post(`/api/v1/parties/admin/riders/${riderId}/activate`, partyAdmin, { version: 1, kycCaseId: riderKyc, reason: 'approved rider evidence' }).expect(201);
}, 120000);
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('store serviceability and rider eligibility foundation', () => {
  it('requires approved pickup geometry, operating hours and an approved service area before dispatch serviceability', async () => {
    const initial = await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200);
    expect(initial.body.serviceable).toBe(false);
    const pickup = await post(`/api/v1/catalog/stores/${storeId}/pickup-point`, owner, { latitude: 24.75, longitude: 90.4 }).expect(201);
    expect(pickup.body.status).toBe('DRAFT');
    await post(`/api/v1/catalog/admin/stores/${storeId}/pickup-point/review`, owner, { version: 1, decision: 'APPROVE', reason: 'owner self review attempt' }).expect(403);
    await post(`/api/v1/catalog/admin/stores/${storeId}/pickup-point/review`, stranger, { version: 1, decision: 'APPROVE', reason: 'stranger review attempt' }).expect(403);
    const approved = await post(`/api/v1/catalog/admin/stores/${storeId}/pickup-point/review`, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'pickup geometry verified' }).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    await put(`/api/v1/catalog/stores/${storeId}/operating-hours`, owner, { hours: [{ dayOfWeek: 0, openMinute: 540, closeMinute: 1020 }, { dayOfWeek: 1, openMinute: 540, closeMinute: 1020 }] }).expect(200);
    const area = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zoneId }).expect(201);
    const areaApproved = await post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'zone coverage verified' }).expect(201);
    expect(areaApproved.body.status).toBe('APPROVED');
    const ready = await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200);
    expect(ready.body.serviceable).toBe(true);
    expect(ready.body.pickup.latitude).toBeCloseTo(24.75);
    await get(`/api/v1/catalog/stores/${storeId}/serviceability`, stranger).expect(404);
    await post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, serviceabilityAdmin, { version: 2, decision: 'SUSPEND', reason: 'temporary zone coverage hold' }).expect(201);
    const suspended = await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200);
    expect(suspended.body.serviceable).toBe(false);
  });

  it('rejects invalid review transitions without changing state or recording decisions', async () => {
    const current = await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200);
    expect(current.body.pickup.status).toBe('APPROVED');
    const pickupPath = `/api/v1/catalog/admin/stores/${storeId}/pickup-point/review`;
    for (const decision of ['APPROVE', 'REJECT']) {
      const res = await post(pickupPath, serviceabilityAdmin, { version: current.body.pickup.version, decision, reason: 'invalid pickup transition' }).expect(409);
      expect(res.body.code).toBe('PICKUP_INVALID_TRANSITION');
    }
    const afterPickup = await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200);
    expect(afterPickup.body.pickup).toEqual(current.body.pickup);

    const zone = await asSuper(u.privileged, async c => (await c.query(
      `INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
      [randomUUID(), cityId, `transition-${randomUUID().slice(0, 8)}`, 'Transition test zone'],
    )).rows[0].id as string);
    const proposal = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zone }).expect(201);
    const areaId = proposal.body.serviceAreaId as string;
    const path = `/api/v1/catalog/admin/service-areas/${areaId}/review`;
    async function review(version: number, decision: string, status: number) {
      return post(path, serviceabilityAdmin, { version, decision, reason: 'check review transition' }).expect(status);
    }
    async function invalid(version: number, ...decisions: string[]) {
      for (const decision of decisions) expect((await review(version, decision, 409)).body.code).toBe('SERVICE_AREA_INVALID_TRANSITION');
    }
    try {
      await invalid(1, 'SUSPEND');
      expect((await review(1, 'REJECT', 201)).body.status).toBe('REJECTED');
      await invalid(2, 'APPROVE', 'REJECT', 'SUSPEND');
      const retried = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zone }).expect(201);
      expect(retried.body).toMatchObject({ status: 'DRAFT', version: 3 });
      expect((await review(3, 'APPROVE', 201)).body.status).toBe('APPROVED');
      await invalid(4, 'APPROVE', 'REJECT');
      const stale = await review(3, 'SUSPEND', 409);
      expect(stale.body.code).toBe('SERVICE_AREA_VERSION_CONFLICT');
      expect((await review(4, 'SUSPEND', 201)).body.status).toBe('SUSPENDED');
      await invalid(5, 'REJECT', 'SUSPEND');
      const counts = await asSuper(u.privileged, c => c.query(`SELECT
        (SELECT count(*)::int FROM "AuditLog" WHERE "resourceId"=$1 AND action IN ('catalog.store.service_area.approved','catalog.store.service_area.rejected','catalog.store.service_area.suspended')) AS audits,
        (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateId"=$2 AND "eventKey" IN ($3,$4,$5)) AS events`,
        [areaId, storeId, `store-service-area-rejected-${areaId}-2`, `store-service-area-approved-${areaId}-4`, `store-service-area-suspended-${areaId}-5`]));
      expect(counts.rows[0]).toEqual({ audits: 3, events: 3 });
    } finally {
      // Avoid leaving additional approved coverage that affects later tests.
      await asSuper(u.privileged, c => c.query('UPDATE "ServiceZone" SET status=\'INACTIVE\' WHERE id=$1', [zone]));
    }
  });

  it('serializes opposing reviews so the same area version succeeds only once', async () => {
    const zone = await asSuper(u.privileged, async c => (await c.query(
      `INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
      [randomUUID(), cityId, `review-race-${randomUUID().slice(0, 8)}`, 'Review race zone'],
    )).rows[0].id as string);
    const proposal = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zone }).expect(201);
    const areaId = proposal.body.serviceAreaId as string;
    const reviewer2 = await makeUser('second-serviceability-reviewer');
    await grantKeys(reviewer2, ['catalog:store:serviceability:review']);
    const holder = new pg.Client({ connectionString: u.privileged });
    const monitor = new pg.Client({ connectionString: u.privileged });
    await holder.connect(); await monitor.connect();
    let first: Promise<any> | undefined; let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "StoreServiceArea" WHERE id=$1 FOR UPDATE', [areaId]);
      const path = `/api/v1/catalog/admin/service-areas/${areaId}/review`;
      first = post(path, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'verified coverage area' }).then((r: any) => r);
      second = post(path, reviewer2, { version: 1, decision: 'REJECT', reason: 'coverage needs correction' }).then((r: any) => r);
      const deadline = Date.now() + 10000;
      let count = 0;
      while (Date.now() < deadline) {
        // PostgreSQL can queue the second waiter behind the first waiter
        // rather than directly behind the holder. Observe both lock-waiting
        // review queries, not just processes directly blocked by the holder.
        count = (await monitor.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE state='active' AND wait_event_type='Lock'
            AND query LIKE '%StoreServiceArea%' AND query LIKE '%FOR UPDATE%'`)).rows[0].n;
        if (count >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(count).toBe(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end(); await monitor.end();
    }
    const results = await Promise.all([first!, second!]);
    // Keep this extra fixture zone from making later coverage tests pass for
    // the wrong reason if APPROVE won the race.
    await asSuper(u.privileged, c => c.query('UPDATE "ServiceZone" SET status=\'INACTIVE\' WHERE id=$1', [zone]));
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409).body.code).toBe('SERVICE_AREA_VERSION_CONFLICT');
    const winner = results.find(r => r.status === 201).body;
    expect(['APPROVED', 'REJECTED']).toContain(winner.status);
    expect(winner.version).toBe(2);
    const rows = await asSuper(u.privileged, c => c.query(`SELECT
      (SELECT count(*)::int FROM "StoreServiceArea" WHERE id=$1 AND version=2 AND status=$2::"StoreServiceAreaStatus") AS areas,
      (SELECT count(*)::int FROM "AuditLog" WHERE "resourceId"=$1 AND action IN ('catalog.store.service_area.approved','catalog.store.service_area.rejected')) AS audits,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "eventKey" IN ($3,$4)) AS events`,
      [areaId, winner.status, `store-service-area-approved-${areaId}-2`, `store-service-area-rejected-${areaId}-2`]));
    expect(rows.rows[0]).toEqual({ areas: 1, audits: 1, events: 1 });
  });

  it('rejects malformed operating windows without changing the existing schedule or writing audit events', async () => {
    const path = `/api/v1/catalog/stores/${storeId}/operating-hours`;
    const before = (await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200)).body.operatingHours;
    const countRecords = async () => (await asSuper(u.privileged, c => c.query(`SELECT
      (SELECT count(*)::int FROM "AuditLog" WHERE "resourceId"=$1 AND action='catalog.store.hours.replaced') AS audits,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateId"=$1 AND "eventType"='catalog.store.hours.replaced') AS events`, [storeId]))).rows[0];
    const counts = await countRecords();
    for (const window of [null, false, 42, 'invalid', []]) {
      const res = await put(path, owner, { hours: [window] }).expect(400);
      expect(res.body.code).toBe('OPERATING_HOURS_INVALID');
      expect(res.body.message).toBe('Invalid operating hours');
      expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId']);
    }
    const missingDay = await put(path, owner, { hours: [{ openMinute: 540, closeMinute: 1020 }] }).expect(400);
    expect(missingDay.body.code).toBe('OPERATING_DAY_INVALID');
    expect((await get(`/api/v1/catalog/stores/${storeId}/serviceability`, owner).expect(200)).body.operatingHours).toEqual(before);
    expect(await countRecords()).toEqual(counts);
  });

  it('validates operating hours and keeps location samples append-only', async () => {
    await put(`/api/v1/catalog/stores/${storeId}/operating-hours`, owner, { hours: [{ dayOfWeek: 0, openMinute: 540, closeMinute: 1020 }, { dayOfWeek: 0, openMinute: 1000, closeMinute: 1200 }] }).expect(400);
    await put(`/api/v1/catalog/stores/${storeId}/operating-hours`, owner, { hours: [] }).expect(400);
    await post(`/api/v1/catalog/stores/${storeId}/pickup-point`, owner, { latitude: 95, longitude: 90.4 }).expect(400);
    const samples = await asSuper(u.privileged, async c => c.query(`SELECT id FROM "RiderLocationSample" LIMIT 1`));
    if (samples.rows[0]) {
      await expect(asSuper(u.privileged, c => c.query(`UPDATE "RiderLocationSample" SET "accuracyMeters"=1 WHERE id=$1`, [samples.rows[0].id]))).rejects.toThrow(/permission denied|append_only/);
    }
    await expect(asUser(u.runtime, rider.userId, c => c.query(`INSERT INTO "RiderZoneGrant"("id","riderId","serviceZoneId","grantedBy",reason) VALUES ($1,$2,$3,$4,'self grant attempt')`, [randomUUID(), riderId, zoneId, rider.userId]))).rejects.toThrow(/permission denied/);
  });

  it('gates rider dispatch eligibility on consent, active shift, zone grant and fresh accurate location', async () => {
    const before = await get(`/api/v1/riders/me/eligibility?serviceZoneId=${zoneId}`, rider).expect(200);
    expect(before.body.eligible).toBe(false);
    expect(before.body.reasons).toContain('RIDER_LOCATION_CONSENT_REQUIRED');
    await post('/api/v1/riders/me/shifts', rider, { consentVersion: 'gps-v1' }).expect(409);
    await post('/api/v1/riders/me/location-consent', rider, { consented: true, consentVersion: 'gps-v1' }).expect(201);
    const shift = await post('/api/v1/riders/me/shifts', rider, { consentVersion: 'gps-v1' }).expect(201);
    const shiftId = shift.body.shiftId;
    const noGrant = await get(`/api/v1/riders/me/eligibility?serviceZoneId=${zoneId}`, rider).expect(200);
    expect(noGrant.body.reasons).toContain('RIDER_ZONE_GRANT_REQUIRED');
    await post(`/api/v1/admin/riders/${riderId}/zone-grants`, rider, { serviceZoneId: zoneId, reason: 'self grant attempt' }).expect(403);
    const grant = await post(`/api/v1/admin/riders/${riderId}/zone-grants`, zoneAdmin, { serviceZoneId: zoneId, reason: 'pilot zone assignment' }).expect(201);
    await post('/api/v1/riders/me/location-samples', rider, { shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 150, recordedAt: new Date().toISOString() }).expect(201);
    const inaccurate = await get(`/api/v1/riders/me/eligibility?serviceZoneId=${zoneId}`, rider).expect(200);
    expect(inaccurate.body.reasons).toContain('RIDER_LOCATION_ACCURACY');
    await post('/api/v1/riders/me/location-samples', rider, { shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 20, recordedAt: new Date().toISOString() }).expect(201);
    const eligible = await get(`/api/v1/riders/me/eligibility?serviceZoneId=${zoneId}`, rider).expect(200);
    expect(eligible.body.eligible).toBe(true);
    expect(eligible.body.reasons).toEqual([]);
    await post(`/api/v1/admin/rider-zone-grants/${grant.body.grantId}/revoke`, zoneAdmin).expect(201);
    const revoked = await get(`/api/v1/riders/me/eligibility?serviceZoneId=${zoneId}`, rider).expect(200);
    expect(revoked.body.reasons).toContain('RIDER_ZONE_GRANT_REQUIRED');
    await post(`/api/v1/riders/me/shifts/${shiftId}/end`, rider).expect(201);
    await post('/api/v1/riders/me/location-samples', rider, { shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 20, recordedAt: new Date().toISOString() }).expect(409);
  });

  it('withdrawn consent blocks new shifts and samples, and foreign riders cannot use another rider shift', async () => {
    await post('/api/v1/riders/me/location-consent', rider, { consented: true, consentVersion: 'gps-v2' }).expect(201);
    const shift = await post('/api/v1/riders/me/shifts', rider, { consentVersion: 'gps-v2' }).expect(201);
    await post('/api/v1/riders/me/location-consent', rider, { consented: false, consentVersion: 'gps-v2' }).expect(201);
    await post('/api/v1/riders/me/location-samples', rider, { shiftId: shift.body.shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 20, recordedAt: new Date().toISOString() }).expect(409);
    const other = await makeUser('other-rider');
    await post('/api/v1/parties/riders', other, { countryId, vehicleType: 'BICYCLE' }).expect(201);
    await post('/api/v1/riders/me/location-samples', other, { shiftId: shift.body.shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 20, recordedAt: new Date().toISOString() }).expect(403);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "RiderLocationSample" WHERE "riderId"=$1`, [riderId]))).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe('public serviceable-city lookup', () => {
  const publicGet = (path: string) => request(app.getHttpServer()).get(path);

  beforeAll(async () => {
    // The dispatch test above leaves the service area SUSPENDED. Re-approve it
    // explicitly so this suite states its own precondition instead of inheriting
    // another test's final state.
    let area = await asSuper(u.privileged, async c => (await c.query(`SELECT id, version, status FROM "StoreServiceArea" WHERE "storeId"=$1 AND "serviceZoneId"=$2`, [storeId, zoneId])).rows[0]);
    if (!area) {
      const proposed = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zoneId }).expect(201);
      area = { id: proposed.body.serviceAreaId, version: 1, status: 'DRAFT' };
    }
    if (area.status !== 'APPROVED') {
      await post(`/api/v1/catalog/admin/service-areas/${area.id}/review`, serviceabilityAdmin, { version: area.version, decision: 'APPROVE', reason: 'restore coverage for public lookup' }).expect(201);
    }
  });

  it('lists a covered city without needing a session and without leaking store identity', async () => {
    const res = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}`).expect(200);
    expect(res.body.countryId).toBe(countryId);
    expect(res.body.currency).toBe('BDT');
    expect(res.body.truncated).toBe(false);
    const entry = res.body.items.find((c: any) => c.cityId === cityId);
    expect(entry).toBeDefined();
    expect(entry.storeCount).toBeGreaterThanOrEqual(1);
    expect(Object.keys(entry).sort()).toEqual(['cityId', 'code', 'name', 'storeCount']);
    expect(JSON.stringify(res.body)).not.toContain(storeId);
    expect(JSON.stringify(res.body)).not.toContain(vendorId);
  });

  it('does not list an active city that has no covered store', async () => {
    const emptyCity = await asSuper(u.privileged, async c => {
      const region = (await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), countryId, `pub-reg-${randomUUID().slice(0, 8)}`, 'Public Lookup'])).rows[0].id as string;
      const district = (await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), region, `pub-dist-${randomUUID().slice(0, 8)}`, 'Public Lookup'])).rows[0].id as string;
      return (await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,'CITY','ACTIVE') RETURNING id`, [randomUUID(), district, `pub-city-${randomUUID().slice(0, 8)}`, 'Zzz Uncovered City'])).rows[0].id as string;
    });
    const res = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}`).expect(200);
    expect(res.body.items.some((c: any) => c.cityId === emptyCity)).toBe(false);
  });

  it('filters by name and rejects an over-long query', async () => {
    const hit = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId.toUpperCase()}&q=Serviceability`).expect(200);
    expect(hit.body.items.some((c: any) => c.cityId === cityId)).toBe(true);
    const miss = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}&q=NoSuchCityName`).expect(200);
    expect(miss.body.items).toEqual([]);
    const tooLong = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}&q=${'x'.repeat(61)}`).expect(400);
    expect(tooLong.body.code).toBe('QUERY_INVALID');
    expect((await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}&q=a&q=b`).expect(400)).body.code).toBe('QUERY_INVALID');
    expect((await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}&q=a%00b`).expect(400)).body.code).toBe('QUERY_INVALID');
  });

  it('rejects a malformed country id and an unknown country', async () => {
    await publicGet('/api/v1/public/serviceability/cities?countryId=not-a-uuid').expect(400);
    const unknown = await publicGet(`/api/v1/public/serviceability/cities?countryId=${randomUUID()}`).expect(404);
    expect(unknown.body.code).toBe('COUNTRY_NOT_AVAILABLE');
  });

  it('drops the city when its service zone is deactivated, and restores it', async () => {
    await asSuper(u.privileged, async c => { await c.query(`UPDATE "ServiceZone" SET status='INACTIVE' WHERE id=$1`, [zoneId]); });
    try {
      const res = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}`).expect(200);
      expect(res.body.items.some((c: any) => c.cityId === cityId)).toBe(false);
    } finally {
      await asSuper(u.privileged, async c => { await c.query(`UPDATE "ServiceZone" SET status='ACTIVE' WHERE id=$1`, [zoneId]); });
    }
    const restored = await publicGet(`/api/v1/public/serviceability/cities?countryId=${countryId}`).expect(200);
    expect(restored.body.items.some((c: any) => c.cityId === cityId)).toBe(true);
  });
});
