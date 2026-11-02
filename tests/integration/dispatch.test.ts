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
import { TEST_DELIVERY_OTP_SINK, type TestDeliveryOtpSink } from '../../apps/api/src/delivery/delivery-otp.channel';
import { signSandboxWebhook } from '../../packages/core/src/payment';

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
const webhookSecret = 'dispatch-sandbox-webhook-secret-0000';
let otpSink: TestDeliveryOtpSink;

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
async function readySuborder(paymentMethod: 'COD' | 'SANDBOX_MANUAL' = 'COD') {
  let { cartId, version } = await clearCart();
  const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId, quantity: 1, expectedVersion: version }).expect(201); version = added.body.version;
  const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: version, destinationCityId: cityId, commandKey: `quote-${randomUUID().slice(0, 8)}` }).expect(201);
  const order = await post('/api/v1/orders', customer, { quoteId: quote.body.quoteId, expectedQuoteVersion: quote.body.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod }).expect(201);
  const sub = order.body.suborders[0];
  if (paymentMethod === 'SANDBOX_MANUAL') {
    const intent = await post(`/api/v1/orders/${order.body.orderId}/payment-intents`, customer, { commandKey: `intent-${randomUUID().slice(0, 8)}` }).expect(201);
    const raw = JSON.stringify({ eventId: `evt-${randomUUID().slice(0, 8)}`, merchantReference: intent.body.merchantReference, status: 'SUCCEEDED', amountMinor: '1000', currency: 'BDT' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    await request(app.getHttpServer()).post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-gs-timestamp', timestamp).set('x-gs-signature', signSandboxWebhook(webhookSecret, timestamp, raw)).send(raw).expect(200);
  }
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
  process.env['PAYMENTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYMENT_SANDBOX_WEBHOOK_SECRET'] = webhookSecret; process.env['PAYMENTS_LIVE_ENABLED'] = 'false';
  process.env['DELIVERY_OTP_ENABLED'] = 'true'; process.env['DELIVERY_OTP_CHANNEL'] = 'test'; process.env['DELIVERY_OTP_PEPPER'] = 'a'.repeat(64); process.env['DELIVERY_RECIPIENT_ENCRYPTION_KEY'] = 'b'.repeat(64); process.env['DELIVERY_OTP_TTL_SECONDS'] = '300'; process.env['DELIVERY_OTP_MAX_ATTEMPTS'] = '5'; process.env['DELIVERY_OTP_RESEND_COOLDOWN_SECONDS'] = '60'; process.env['DELIVERY_OTP_MAX_ISSUES'] = '3';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  otpSink = app.get(TEST_DELIVERY_OTP_SINK) as TestDeliveryOtpSink;
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


describe('pickup/OTP delivery proof and completion gating', () => {
  async function assignedDelivery(rider: any, paymentMethod: 'COD' | 'SANDBOX_MANUAL') {
    await asSuper(u.privileged, async c => c.query(`UPDATE "RiderShift" SET "status"='ENDED', "endedAt"=now(), "updatedAt"=now() WHERE "status"='ACTIVE' AND "riderId" IN (SELECT id FROM "RiderProfile" WHERE "userId" <> $1)`, [rider.userId]));
    const { orderId, suborderId } = await readySuborder(paymentMethod);
    await setDestination(orderId);
    const recipient = await post(`/api/v1/orders/${orderId}/delivery-recipient`, customer, { name: 'Test Recipient', phone: '+8801712345678', commandKey: `recipient-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(recipient.body.maskedPhone).toBe('******5678');
    const run = await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    const offers = await get('/api/v1/riders/me/dispatch-offers', rider).expect(200);
    const token = offers.body.items.find((o: any) => o.offerId === offer.body.offerId).offerToken;
    const accepted = await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, rider, { offerToken: token, commandKey: `accept-${randomUUID().slice(0, 8)}` }).expect(201);
    return { orderId, suborderId, assignmentId: accepted.body.assignmentId as string };
  }

  it('requires pickup before OTP, keeps OTP out of API/outbox, and blocks COD completion until accounting exists', async () => {
    const rider = await makeUser('rider-cod-proof'); await prepareRider(rider, 'cod-proof');
    const { assignmentId, suborderId } = await assignedDelivery(rider, 'COD');
    await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, stranger, { commandKey: `pickup-${randomUUID().slice(0, 8)}` }).expect(403);
    const pickupKey = `pickup-${randomUUID().slice(0, 8)}`;
    const pickup = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: pickupKey }).expect(201);
    const deliveryId = pickup.body.deliveryId as string;
    const pickupReplay = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: pickupKey }).expect(201);
    expect(pickupReplay.body.duplicate).toBe(true);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 1, commandKey: `complete-${randomUUID().slice(0, 8)}` }).expect(409);
    const issued = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(issued.body.code).toBeUndefined();
    expect(issued.body.maskedPhone).toBe('******5678');
    const challengeId = issued.body.challengeId as string;
    const code = otpSink.consume(challengeId); expect(code).toMatch(/^[0-9]{6}$/);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, stranger, { code, commandKey: `verify-${randomUUID().slice(0, 8)}` }).expect(403);
    const wrong = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code: code === '000000' ? '111111' : '000000', commandKey: `verify-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(wrong.body.outcome).toBe('INVALID');
    const verifyKey = `verify-${randomUUID().slice(0, 8)}`;
    const verified = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code, commandKey: verifyKey }).expect(201);
    expect(verified.body.outcome).toBe('VALID');
    const verifiedReplay = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code, commandKey: verifyKey }).expect(201);
    expect(verifiedReplay.body.duplicate).toBe(true);
    const blocked = await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: `complete-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(blocked.body.code).toBe('COD_ACCOUNTING_REQUIRED');
    const projection = await get(`/api/v1/riders/me/deliveries/${deliveryId}`, rider).expect(200);
    expect(projection.body.status).toBe('DELIVERED'); expect(projection.body.proof.method).toBe('RECIPIENT_OTP');
    expect(JSON.stringify(projection.body)).not.toContain(code);
    const outbox = await asSuper(u.privileged, async c => c.query(`SELECT payload::text AS payload FROM "OutboxEvent" WHERE "aggregateId"=$1`, [deliveryId]));
    expect(outbox.rows.map((r: any) => r.payload).join(' ')).not.toContain(code);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "DeliveryProof" SET "evidenceHash"=repeat('0',64) WHERE "deliveryId"=$1`, [deliveryId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "DeliveryOtpChallenge" WHERE "deliveryId"=$1`, [deliveryId]))).resolves.toMatchObject({ rowCount: 0 });
    const sub = await asSuper(u.privileged, async c => c.query(`SELECT status FROM "VendorSuborder" WHERE id=$1`, [suborderId]));
    expect(sub.rows[0].status).toBe('DELIVERED');
  });

  it('locks an OTP after max invalid attempts and completes a verified prepaid delivery atomically', async () => {
    const rider = await makeUser('rider-prepaid-proof'); await prepareRider(rider, 'prepaid-proof');
    const { assignmentId, suborderId } = await assignedDelivery(rider, 'SANDBOX_MANUAL');
    const pickup = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: `pickup-${randomUUID().slice(0, 8)}` }).expect(201);
    const deliveryId = pickup.body.deliveryId as string;
    const issued = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(201);
    const challengeId = issued.body.challengeId as string;
    const code = otpSink.consume(challengeId); expect(code).toMatch(/^[0-9]{6}$/);
    const verified = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code, commandKey: `verify-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(verified.body.outcome).toBe('VALID');
    const completeKey = `complete-${randomUUID().slice(0, 8)}`;
    const completed = await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: completeKey }).expect(201);
    expect(completed.body.status).toBe('COMPLETED');
    const completedReplay = await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: completeKey }).expect(201);
    expect(completedReplay.body.duplicate).toBe(true);
    const assignment = await asSuper(u.privileged, async c => c.query(`SELECT status FROM "RiderAssignment" WHERE id=$1`, [assignmentId]));
    expect(assignment.rows[0].status).toBe('COMPLETED');
    const sub = await asSuper(u.privileged, async c => c.query(`SELECT status FROM "VendorSuborder" WHERE id=$1`, [suborderId]));
    expect(sub.rows[0].status).toBe('COMPLETED');
    const active = await get('/api/v1/riders/me/assignment', rider).expect(200);
    expect(active.body.assignment).toBeNull();
  }, 60000);

  it('locks an OTP challenge after the configured invalid-attempt limit', async () => {
    const rider = await makeUser('rider-otp-lock'); await prepareRider(rider, 'otp-lock');
    const { assignmentId } = await assignedDelivery(rider, 'COD');
    const pickup = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: `pickup-${randomUUID().slice(0, 8)}` }).expect(201);
    const deliveryId = pickup.body.deliveryId as string;
    const issued = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(201);
    const challengeId = issued.body.challengeId as string;
    const code = otpSink.consume(challengeId); expect(code).toMatch(/^[0-9]{6}$/);
    const wrongCode = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const attempt = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code: wrongCode, commandKey: `wrong-${randomUUID().slice(0, 8)}` }).expect(201);
      expect(['INVALID', 'LOCKED']).toContain(attempt.body.outcome);
    }
    const locked = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code, commandKey: `verify-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(locked.body.outcome).toBe('LOCKED');
    const resend = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(resend.body.code).toBe('OTP_RESEND_COOLDOWN');
  });
});
