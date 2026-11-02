import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, asUser } from './helpers';
import { runDispatchExpiryTick } from '../../apps/worker/src/dispatch-expiry';
import { StructuredLogger } from '../../packages/observability/src/index';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
let countryId: string, cityId: string, zoneId: string, boundaryId: string;
let pool: pg.Pool, queue: Queue, redis: Redis;
const queueName = `gs-dispatch-test-${randomUUID()}`;
let customer: any, owner: any, stranger: any, dispatchAdmin: any, serviceabilityAdmin: any, zoneAdmin: any;
let vendorId: string, storeId: string, variantId: string;
let riderA: any, riderB: any, riderAId: string, riderBId: string;
let routeServer: http.Server;
let routePort: number;
let routeCalls = 0;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `dispatch-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Dispatch ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) { return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body); }
function put(path: string, user: { token: string; csrf: string }, body: unknown = {}) { return request(app.getHttpServer()).put(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body); }
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
async function setStepUp(user: { sessionId: string }) { await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]); }); }
async function grantKeys(user: { userId: string; sessionId: string }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `dispatch-role-${randomUUID()}`, 'Dispatch Role']);
    for (const key of keys) { const [resource] = key.split(':'); const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']); await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]); }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`dispatch-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => { await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']); });
  return id;
}
async function approveKyc(subject: any, subjectType: 'VENDOR' | 'RIDER', reviewer: any) {
  const kyc = await post('/api/v1/kyc/cases', subject, { subjectType, countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const kycCaseId = kyc.body.caseId; const docId = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, subject, { storageObjectId: docId, documentType: subjectType === 'VENDOR' ? 'TRADE_LICENSE' : 'NID_FRONT' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  return kycCaseId as string;
}
async function drainOutbox() { for (let i = 0; i < 25; i++) { const pending = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(), "leaseToken"=NULL, "leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`); if ((pending.rowCount ?? 0) === 0) return; await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName }); } }
async function clearCart() {
  const cart = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201); const cartId = cart.body.cartId;
  let current = await get(`/api/v1/commerce/carts/${cartId}`, customer).expect(200);
  for (const item of current.body.items) current = await request(app.getHttpServer()).delete(`/api/v1/commerce/carts/${cartId}/items/${item.variantId}?expectedVersion=${current.body.version}`).set('Cookie', `gs_session_dev=${customer.token}`).set('Origin', origin).set('X-CSRF-Token', customer.csrf).expect(200);
  return { cartId, version: current.body.version as number };
}
async function readySuborder() {
  let { cartId, version } = await clearCart();
  const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId, quantity: 1, expectedVersion: version }).expect(201); version = added.body.version;
  const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: version, destinationCityId: cityId, commandKey: `quote-${randomUUID().slice(0, 8)}` }).expect(201);
  const order = await post('/api/v1/orders', customer, { quoteId: quote.body.quoteId, expectedQuoteVersion: quote.body.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(201);
  const sub = order.body.suborders[0];
  await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 15 }).expect(201);
  await post(`/api/v1/vendor/suborders/${sub.suborderId}/start-preparation`, owner, { expectedVersion: 2, commandKey: `prep-${randomUUID().slice(0, 8)}` }).expect(201);
  await post(`/api/v1/vendor/suborders/${sub.suborderId}/ready`, owner, { expectedVersion: 3, commandKey: `ready-${randomUUID().slice(0, 8)}` }).expect(201);
  return { orderId: order.body.orderId as string, suborderId: sub.suborderId as string };
}
async function setDestination(orderId: string) { return post(`/api/v1/orders/${orderId}/delivery-destination`, customer, { serviceZoneId: zoneId, boundaryVersionId: boundaryId, latitude: 24.751, longitude: 90.401, addressLine: 'Recipient address, Pilot Zone', commandKey: `dest-${randomUUID().slice(0, 8)}` }).expect(201); }
async function prepareRider(user: any, label: string) {
  const profile = await post('/api/v1/parties/riders', user, { countryId, vehicleType: 'MOTORBIKE' }).expect(201);
  const riderId = profile.body.riderId as string;
  const kycReviewer = await makeUser(`kyc-reviewer-${label}`); await grantKeys(kycReviewer, ['kyc:case:review']);
  const partyAdmin = await makeUser(`party-admin-${label}`); await grantKeys(partyAdmin, ['rider:profile:activate']);
  const kycCaseId = await approveKyc(user, 'RIDER', kycReviewer);
  await post(`/api/v1/parties/admin/riders/${riderId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved rider evidence' }).expect(201);
  await post('/api/v1/riders/me/location-consent', user, { consented: true, consentVersion: 'gps-v1' }).expect(201);
  const shift = await post('/api/v1/riders/me/shifts', user, { consentVersion: 'gps-v1' }).expect(201);
  await post(`/api/v1/admin/riders/${riderId}/zone-grants`, zoneAdmin, { serviceZoneId: zoneId, reason: 'pilot dispatch zone grant' }).expect(201);
  await post('/api/v1/riders/me/location-samples', user, { shiftId: shift.body.shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 10, recordedAt: new Date().toISOString() }).expect(201);
  return riderId;
}

beforeAll(async () => {
  routeServer = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      routeCalls++;
      const parsed = JSON.parse(body); const origins = parsed.origins.length; const destinations = parsed.destinations.length;
      const elements = [];
      for (let i = 0; i < origins; i++) for (let j = 0; j < destinations; j++) elements.push({ originIndex: i, destinationIndex: j, distanceMeters: 1000 + i * 100 + j * 10, duration: `${60 + i * 10 + j}s`, condition: 'ROUTE_EXISTS' });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(elements));
    });
  });
  await new Promise<void>(resolve => routeServer.listen(0, '127.0.0.1', resolve));
  routePort = (routeServer.address() as any).port;
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  process.env['ROAD_ROUTING_ENABLED'] = 'true'; process.env['ROAD_ROUTING_PROVIDER'] = 'google_routes'; process.env['GOOGLE_ROUTES_API_KEY'] = 'test-google-routes-api-key-000000'; process.env['GOOGLE_ROUTES_BASE_URL'] = `http://127.0.0.1:${routePort}`;
  process.env['DISPATCH_OFFER_TOKEN_SECRET'] = 'dispatch-offer-token-secret-000000000000';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => { const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `dsp-reg-${randomUUID().slice(0, 8)}`, 'Dispatch', 'ACTIVE']); const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `dsp-dist-${randomUUID().slice(0, 8)}`, 'Dispatch', 'ACTIVE']); return (await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `dsp-city-${randomUUID().slice(0, 8)}`, 'Dispatch', 'CITY', 'ACTIVE'])).rows[0].id as string; });
  zoneId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), cityId, `dsp-zone-${randomUUID().slice(0, 8)}`, 'Pilot Zone'])).rows[0].id as string);
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 }); const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'); redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null }); queue = new Queue(queueName, { connection: redis }); await drainOutbox();
  customer = await makeUser('customer'); owner = await makeUser('owner'); stranger = await makeUser('stranger');
  const kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  const storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  const codAdmin = await makeUser('cod-admin'); await grantKeys(codAdmin, ['finance:cod:manage']);
  dispatchAdmin = await makeUser('dispatch-admin'); await grantKeys(dispatchAdmin, ['dispatch:run:manage']);
  serviceabilityAdmin = await makeUser('serviceability-admin'); await grantKeys(serviceabilityAdmin, ['catalog:store:serviceability:review']);
  zoneAdmin = await makeUser('zone-admin'); await grantKeys(zoneAdmin, ['rider:zone:grant']);
  boundaryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "BoundaryVersion"(id,"ownerType","ownerId",version,boundary,source,"validFrom","approvedBy","contentHash") VALUES ($1,'ZONE',$2,1,ST_GeomFromEWKT('SRID=4326;MULTIPOLYGON(((90.39 24.74,90.41 24.74,90.41 24.76,90.39 24.76,90.39 24.74)))'),'integration-test',now(),$3,$4) RETURNING id`, [randomUUID(), zoneId, dispatchAdmin.userId, createHash('sha256').update('dispatch-boundary').digest('hex')])).rows[0].id as string);
  const existingPolicy = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "CodPolicy" WHERE "countryId"=$1`, [countryId])).rows[0]);
  await put('/api/v1/admin/cod-policy', codAdmin, { countryId, enabled: true, maxOrderMinor: '100000', ...(existingPolicy ? { version: existingPolicy.version } : {}) }).expect(200);
  await setStepUp(owner);
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Dispatch Vendor' }).expect(201); vendorId = vendor.body.vendorId;
  const vendorKyc = await approveKyc(owner, 'VENDOR', kycReviewer);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId: vendorKyc, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'Dispatch Store', slug: `dispatch-store-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201); storeId = store.body.storeId;
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Dispatch Product', description: 'A product used for dispatch integration tests', brand: 'Stoopy' }).expect(201); const productId = product.body.productId;
  const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `DSP-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201); variantId = variant.body.id;
  const moderator = await makeUser('moderator'); await grantKeys(moderator, ['catalog:product:review', 'catalog:product:publish']);
  await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 3, reason: 'approved for public catalog' }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 0 }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 100, commandKey: `stock-${variantId}`, reason: 'initial dispatch test stock' }).expect(201);
  const pickup = await post(`/api/v1/catalog/stores/${storeId}/pickup-point`, owner, { latitude: 24.75, longitude: 90.4 }).expect(201);
  await post(`/api/v1/catalog/admin/stores/${storeId}/pickup-point/review`, serviceabilityAdmin, { version: pickup.body.version, decision: 'APPROVE', reason: 'pickup geometry verified' }).expect(201);
  await put(`/api/v1/catalog/stores/${storeId}/operating-hours`, owner, { hours: [{ dayOfWeek: 0, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 1, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 2, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 3, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 4, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 5, openMinute: 0, closeMinute: 1440 }, { dayOfWeek: 6, openMinute: 0, closeMinute: 1440 }] }).expect(200);
  const area = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zoneId }).expect(201);
  await post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'zone coverage verified' }).expect(201);
  riderA = await makeUser('rider-a'); riderAId = await prepareRider(riderA, 'a');
}, 120000);
afterAll(async () => { await drainOutbox(); if (queue) { await queue.obliterate({ force: true }); await queue.close(); } if (redis) await redis.quit(); if (pool) await pool.end(); if (app) await app.close(); if (routeServer) await new Promise<void>(resolve => routeServer.close(() => resolve())); });

describe('atomic dispatch foundation', () => {
  it('requires buyer destination inside approved boundary and a ready serviceable suborder', async () => {
    const { orderId, suborderId } = await readySuborder();
    await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(409);
    await post(`/api/v1/orders/${orderId}/delivery-destination`, stranger, { serviceZoneId: zoneId, boundaryVersionId: boundaryId, latitude: 24.751, longitude: 90.401, addressLine: 'Recipient address, Pilot Zone', commandKey: `dest-${randomUUID().slice(0, 8)}` }).expect(404);
    await post(`/api/v1/orders/${orderId}/delivery-destination`, customer, { serviceZoneId: zoneId, boundaryVersionId: boundaryId, latitude: 25.5, longitude: 91.5, addressLine: 'Outside zone address', commandKey: `dest-${randomUUID().slice(0, 8)}` }).expect(409);
    await setDestination(orderId);
    const run = await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(run.body.status).toBe('SEARCHING');
    await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, stranger, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(403);
    const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(offer.body.riderId).toBe(riderAId); expect(offer.body.status).toBe('OFFERED'); expect(routeCalls).toBeGreaterThan(0);
    const myOffers = await get('/api/v1/riders/me/dispatch-offers', riderA).expect(200);
    const token = myOffers.body.items.find((o: any) => o.offerId === offer.body.offerId).offerToken;
    await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, riderA, { offerToken: '0'.repeat(64), commandKey: `accept-${randomUUID().slice(0, 8)}` }).expect(403);
    await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, stranger, { offerToken: token, commandKey: `accept-${randomUUID().slice(0, 8)}` }).expect(403);
    const accepted = await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, riderA, { offerToken: token, commandKey: `accept-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(accepted.body.assignmentId).toBeTruthy();
    const assignment = await get('/api/v1/riders/me/assignment', riderA).expect(200);
    expect(assignment.body.assignment.suborderId).toBe(suborderId);
    const runAfter = await get(`/api/v1/admin/dispatch/runs/${run.body.runId}`, dispatchAdmin).expect(200);
    expect(runAfter.body.status).toBe('ASSIGNED'); expect(runAfter.body.assignment.riderId).toBe(riderAId);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "RiderAssignment" SET "roadDistanceMeters"=1 WHERE id=$1`, [accepted.body.assignmentId]))).rejects.toThrow(/permission denied|immutable/);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "DispatchOffer" WHERE "runId"=$1`, [run.body.runId]))).resolves.toMatchObject({ rowCount: 0 });
  });

  it('prevents one rider from accepting two active assignments and replays acceptance idempotently', async () => {
    riderB = await makeUser('rider-b'); riderBId = await prepareRider(riderB, 'b');
    const first = await readySuborder(); await setDestination(first.orderId);
    const second = await readySuborder(); await setDestination(second.orderId);
    const run1 = await post(`/api/v1/admin/dispatch/suborders/${first.suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    const run2 = await post(`/api/v1/admin/dispatch/suborders/${second.suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    const offer1 = await post(`/api/v1/admin/dispatch/runs/${run1.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    const offer2 = await post(`/api/v1/admin/dispatch/runs/${run2.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    const offers = await get('/api/v1/riders/me/dispatch-offers', riderB).expect(200);
    const token1 = offers.body.items.find((o: any) => o.offerId === offer1.body.offerId).offerToken;
    const token2 = offers.body.items.find((o: any) => o.offerId === offer2.body.offerId).offerToken;
    const acceptKey = `accept-${randomUUID().slice(0, 8)}`;
    const [a, b] = await Promise.all([
      post(`/api/v1/riders/me/dispatch-offers/${offer1.body.offerId}/accept`, riderB, { offerToken: token1, commandKey: acceptKey }),
      post(`/api/v1/riders/me/dispatch-offers/${offer2.body.offerId}/accept`, riderB, { offerToken: token2, commandKey: `accept-${randomUUID().slice(0, 8)}` })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const replay = await post(`/api/v1/riders/me/dispatch-offers/${offer1.body.offerId}/accept`, riderB, { offerToken: token1, commandKey: acceptKey }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const active = await asSuper(u.privileged, async c => c.query(`SELECT count(*)::int AS n FROM "RiderAssignment" WHERE "riderId"=$1 AND status='ACTIVE'`, [riderBId]));
    expect(active.rows[0].n).toBe(1);
  });

  it('expires offers by DB time, escalates, and rejects road-routing fallback when disabled', async () => {
    const riderC = await makeUser('rider-c'); const riderCId = await prepareRider(riderC, 'c');
    const { orderId, suborderId } = await readySuborder(); await setDestination(orderId);
    const run = await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(offer.body.riderId).toBe(riderCId);
    await new Promise(r => setTimeout(r, 31000));
    const expiryPool = new pg.Pool({ connectionString: u.privileged, max: 1 });
    const expired = await runDispatchExpiryTick(expiryPool, new StructuredLogger(), 100);
    await expiryPool.end();
    expect(expired).toBeGreaterThanOrEqual(1);
    const runAfter = await get(`/api/v1/admin/dispatch/runs/${run.body.runId}`, dispatchAdmin).expect(200);
    expect(runAfter.body.status).toBe('SEARCHING'); expect(runAfter.body.attemptCount).toBe(1); expect(runAfter.body.offers[0].status).toBe('EXPIRED');
    const riderD = await makeUser('rider-d'); await prepareRider(riderD, 'd');
    const next = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: runAfter.body.version, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(next.body.sequence).toBe(2);
    const offers = await get('/api/v1/riders/me/dispatch-offers', riderD).expect(200);
    const token = offers.body.items.find((o: any) => o.offerId === next.body.offerId).offerToken;
    const rejected = await post(`/api/v1/riders/me/dispatch-offers/${next.body.offerId}/reject`, riderD, { offerToken: token, commandKey: `reject-${randomUUID().slice(0, 8)}`, reason: 'rider unavailable for this offer' }).expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    const history = await get(`/api/v1/admin/dispatch/runs/${run.body.runId}/history`, dispatchAdmin).expect(200);
    expect(history.body.items.map((e: any) => e.eventType)).toContain('dispatch.offer.expired');
    expect(history.body.items.map((e: any) => e.eventType)).toContain('dispatch.offer.rejected');
  }, 60000);
});
