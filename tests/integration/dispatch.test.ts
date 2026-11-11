import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { VendorSettlementsService } from '../../apps/api/src/finance/vendor-settlements.service.js';
import { FinanceOperationsService } from '../../apps/api/src/finance/finance-operations.service.js';
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
async function grantKeys(user: { userId: string; sessionId: string; authVersion?: number }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `dispatch-role-${randomUUID()}`, 'Dispatch Role']);
    for (const key of keys) { const [resource] = key.split(':'); const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']); await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]); }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=$1`,[user.userId]);
    await c.query(`UPDATE "Session" SET "authVersion"=(SELECT "authorizationVersion" FROM "User" WHERE id=$1) WHERE id=$2`,[user.userId,user.sessionId]);
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
  process.env['PAYOUT_DESTINATION_ENCRYPTION_KEY'] = 'f'.repeat(64); process.env['PAYOUTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYOUTS_LIVE_ENABLED'] = 'false';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  process.env['ROAD_ROUTING_ENABLED'] = 'true'; process.env['ROAD_ROUTING_PROVIDER'] = 'google_routes'; process.env['GOOGLE_ROUTES_API_KEY'] = 'test-google-routes-api-key-000000'; process.env['GOOGLE_ROUTES_BASE_URL'] = `http://127.0.0.1:${routePort}`;
  process.env['DISPATCH_OFFER_TOKEN_SECRET'] = 'dispatch-offer-token-secret-000000000000';
  process.env['PAYMENTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYMENT_SANDBOX_WEBHOOK_SECRET'] = webhookSecret; process.env['PAYMENTS_LIVE_ENABLED'] = 'false';
  process.env['RISK_SIGNAL_PRODUCERS_ENABLED'] = 'true';
  process.env['DELIVERY_OTP_ENABLED'] = 'true'; process.env['DELIVERY_OTP_CHANNEL'] = 'test'; process.env['DELIVERY_OTP_PEPPER'] = 'a'.repeat(64); process.env['DELIVERY_RECIPIENT_ENCRYPTION_KEY'] = 'b'.repeat(64); process.env['DELIVERY_OTP_TTL_SECONDS'] = '300'; process.env['DELIVERY_OTP_MAX_ATTEMPTS'] = '5'; process.env['DELIVERY_OTP_RESEND_COOLDOWN_SECONDS'] = '60'; process.env['DELIVERY_OTP_MAX_ISSUES'] = '3';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  otpSink = app.get(TEST_DELIVERY_OTP_SINK) as TestDeliveryOtpSink;
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  await asSuper(u.privileged, async c => {
    const adminId = randomUUID();
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,'Rate Seed',now())`, [adminId]);
    const ruleId = randomUUID();
    await c.query(`INSERT INTO "RiderRateRule"(id,"countryId",currency,status,"effectiveFrom","commandKey","payloadHash","createdByUserId") VALUES ($1,$2,'BDT','ACTIVE',now()-interval '1 hour',$3,$4,$5)`, [ruleId, countryId, `rate-seed-${randomUUID()}`, 'a'.repeat(64), adminId]);
    await c.query(`INSERT INTO "RiderRateSlab"(id,"ruleId","lowerMeters","upperMeters","amountMinor") VALUES ($1,$2,0,2000,6000),($3,$2,2000,NULL,9000)`, [randomUUID(), ruleId, randomUUID()]);
  });
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
afterAll(async () => { process.env['RISK_SIGNAL_PRODUCERS_ENABLED'] = 'false'; await drainOutbox(); if (queue) { await queue.obliterate({ force: true }); await queue.close(); } if (redis) await redis.quit(); if (pool) await pool.end(); if (app) await app.close(); if (routeServer) await new Promise<void>(resolve => routeServer.close(() => resolve())); });

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
    const acceptKey1 = `accept-${randomUUID().slice(0, 8)}`;
    const acceptKey2 = `accept-${randomUUID().slice(0, 8)}`;
    const [a, b] = await Promise.all([
      post(`/api/v1/riders/me/dispatch-offers/${offer1.body.offerId}/accept`, riderB, { offerToken: token1, commandKey: acceptKey1 }),
      post(`/api/v1/riders/me/dispatch-offers/${offer2.body.offerId}/accept`, riderB, { offerToken: token2, commandKey: acceptKey2 })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // Lock scheduling decides which offer wins. Replay that winner, never assume offer1 wins.
    const winner = a.status === 201
      ? { response: a, offer: offer1, token: token1, commandKey: acceptKey1 }
      : { response: b, offer: offer2, token: token2, commandKey: acceptKey2 };
    const loser = a.status === 201 ? b : a;
    expect(winner.response.body.assignmentId).toBeTruthy();
    expect(loser.body.code).toBe('RIDER_NOT_ELIGIBLE');
    const replay = await post(`/api/v1/riders/me/dispatch-offers/${winner.offer.body.offerId}/accept`, riderB, { offerToken: winner.token, commandKey: winner.commandKey }).expect(201);
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
    const issueKey = `otp-${randomUUID().slice(0, 8)}`;
    const issuePath = `/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`;
    const issued = await post(issuePath, rider, { commandKey: issueKey }).expect(201);
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
    // A lost issue response can be retried even after another request verified it.
    const issueReplay = await post(issuePath, rider, { commandKey: issueKey }).expect(201);
    expect(issueReplay.body).toMatchObject({ challengeId, status: 'VERIFIED', duplicate: true });
    expect(issueReplay.body.code).toBeUndefined();
    await post(issuePath, riderA, { commandKey: issueKey }).expect(404);
    const newIssue = await post(issuePath, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(newIssue.body.code).toBe('OTP_NOT_ALLOWED');
    const completeKey = `complete-${randomUUID().slice(0, 8)}`;
    const completed = await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: completeKey }).expect(201);
    expect(completed.body.status).toBe('COMPLETED');
    const completedIssueReplay = await post(issuePath, rider, { commandKey: issueKey }).expect(201);
    expect(completedIssueReplay.body).toMatchObject({ challengeId, status: 'VERIFIED', duplicate: true });
    expect(otpSink.consume(challengeId)).toBeNull();
    const issueCounts = await asSuper(u.privileged, async c => c.query(`SELECT (SELECT count(*)::int FROM "DeliveryOtpChallenge" WHERE "deliveryId"=$1) AS challenges, (SELECT count(*)::int FROM "DeliveryEvent" WHERE "deliveryId"=$1 AND "eventType"='delivery.otp.issued') AS events, (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateId"=$1 AND "eventType"='delivery.otp.issued') AS outbox`, [deliveryId]));
    expect(issueCounts.rows[0]).toEqual({ challenges: 1, events: 1, outbox: 1 });
    const projection = await get(`/api/v1/riders/me/deliveries/${deliveryId}`, rider).expect(200);
    expect(projection.body.status).toBe('COMPLETED'); expect(projection.body.proof.method).toBe('RECIPIENT_OTP');
    expect(JSON.stringify(projection.body)).not.toContain(code);
    const outbox = await asSuper(u.privileged, async c => c.query(`SELECT payload::text AS payload FROM "OutboxEvent" WHERE "aggregateId"=$1`, [deliveryId]));
    expect(outbox.rows.map((r: any) => r.payload).join(' ')).not.toContain(code);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "DeliveryProof" SET "evidenceHash"=repeat('0',64) WHERE "deliveryId"=$1`, [deliveryId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "DeliveryOtpChallenge" WHERE "deliveryId"=$1`, [deliveryId]))).resolves.toMatchObject({ rowCount: 0 });
    const sub = await asSuper(u.privileged, async c => c.query(`SELECT status FROM "VendorSuborder" WHERE id=$1`, [suborderId]));
    expect(sub.rows[0].status).toBe('COMPLETED');
    const cod = await asSuper(u.privileged, async c => c.query(`SELECT cc."amountMinor", cc.currency FROM "CodCollection" cc WHERE cc."deliveryId"=$1`, [deliveryId]));
    expect(cod.rows[0]).toMatchObject({ amountMinor: '1000', currency: 'BDT' });
    const earning = await asSuper(u.privileged, async c => c.query(`SELECT "amountMinor" FROM "RiderEarning" WHERE "deliveryId"=$1`, [deliveryId]));
    expect(earning.rows[0].amountMinor).toBe('6000');
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

  it('serializes recipient issue limits across an order’s separate deliveries', async () => {
    // A second store of the same vendor creates a second real suborder in one order.
    const storeAdmin = await makeUser('otp-rate-store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
    const moderator = await makeUser('otp-rate-moderator'); await grantKeys(moderator, ['catalog:product:review', 'catalog:product:publish']);
    const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'OTP Rate Store', slug: `otp-rate-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const otherStoreId = store.body.storeId as string;
    await post(`/api/v1/catalog/admin/stores/${otherStoreId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
    const product = await post(`/api/v1/catalog/stores/${otherStoreId}/products`, owner, { title: 'OTP Rate Product', description: 'A product for recipient issue limit tests', brand: 'Stoopy' }).expect(201);
    const variant = await post(`/api/v1/catalog/products/${product.body.productId}/variants`, owner, { sku: `OTP-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
    await post(`/api/v1/catalog/products/${product.body.productId}/submit`, owner, { version: 1 }).expect(201);
    await post(`/api/v1/catalog/admin/products/${product.body.productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${product.body.productId}/publish`, moderator, { version: 3, reason: 'approved for public catalog' }).expect(201);
    await post(`/api/v1/inventory/variants/${variant.body.id}/initialize`, owner, { reorderLevel: 0 }).expect(201);
    await post(`/api/v1/inventory/variants/${variant.body.id}/adjustments`, owner, { version: 1, delta: 10, commandKey: `stock-${randomUUID()}`, reason: 'OTP rate test stock' }).expect(201);
    const pickupPoint = await post(`/api/v1/catalog/stores/${otherStoreId}/pickup-point`, owner, { latitude: 24.75, longitude: 90.4 }).expect(201);
    await post(`/api/v1/catalog/admin/stores/${otherStoreId}/pickup-point/review`, serviceabilityAdmin, { version: pickupPoint.body.version, decision: 'APPROVE', reason: 'pickup geometry verified' }).expect(201);
    await put(`/api/v1/catalog/stores/${otherStoreId}/operating-hours`, owner, { hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, openMinute: 0, closeMinute: 1440 })) }).expect(200);
    const area = await post(`/api/v1/catalog/stores/${otherStoreId}/service-areas`, owner, { serviceZoneId: zoneId }).expect(201);
    await post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'zone coverage verified' }).expect(201);
    const riders = [await makeUser('recipient-rate-a'), await makeUser('recipient-rate-b')];
    for (let i = 0; i < riders.length; i++) await prepareRider(riders[i], `recipient-rate-${i}`);
    let { cartId, version } = await clearCart();
    const firstItem = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId, quantity: 1, expectedVersion: version }).expect(201);
    const secondItem = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variant.body.id, quantity: 1, expectedVersion: firstItem.body.version }).expect(201);
    const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: secondItem.body.version, destinationCityId: cityId, commandKey: `quote-${randomUUID()}` }).expect(201);
    const order = await post('/api/v1/orders', customer, { quoteId: quote.body.quoteId, expectedQuoteVersion: quote.body.version, commandKey: `order-${randomUUID()}`, paymentMethod: 'COD' }).expect(201);
    expect(order.body.suborders).toHaveLength(2);
    await setDestination(order.body.orderId);
    const recipient = await post(`/api/v1/orders/${order.body.orderId}/delivery-recipient`, customer, { name: 'Test Recipient', phone: '+8801712345678', commandKey: `recipient-${randomUUID()}` }).expect(201);
    for (const sub of order.body.suborders) {
      await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 1, commandKey: `accept-${randomUUID()}`, preparationMinutes: 15 }).expect(201);
      await post(`/api/v1/vendor/suborders/${sub.suborderId}/start-preparation`, owner, { expectedVersion: 2, commandKey: `prep-${randomUUID()}` }).expect(201);
      await post(`/api/v1/vendor/suborders/${sub.suborderId}/ready`, owner, { expectedVersion: 3, commandKey: `ready-${randomUUID()}` }).expect(201);
    }
    const deliveries: string[] = [];
    for (let i = 0; i < 2; i++) {
      await asSuper(u.privileged, c => c.query(`UPDATE "RiderShift" SET "status"='ENDED', "endedAt"=now(), "updatedAt"=now() WHERE "status"='ACTIVE' AND "riderId" IN (SELECT id FROM "RiderProfile" WHERE "userId" <> ALL($1::uuid[]))`, [riders.slice(i).map(r => r.userId)]));
      // Hide the second rider for the first offer, without ending its shift.
      if (i === 0) await asSuper(u.privileged, c => c.query(`UPDATE "RiderShift" SET "status"='ENDED', "endedAt"=now(), "updatedAt"=now() WHERE "status"='ACTIVE' AND "riderId" IN (SELECT id FROM "RiderProfile" WHERE "userId"=$1)`, [riders[1].userId]));
      if (i === 1) {
        const shift = await post('/api/v1/riders/me/shifts', riders[i], { consentVersion: 'gps-v1' }).expect(201);
        await post('/api/v1/riders/me/location-samples', riders[i], { shiftId: shift.body.shiftId, latitude: 24.75, longitude: 90.4, accuracyMeters: 10, recordedAt: new Date().toISOString() }).expect(201);
      }
      const run = await post(`/api/v1/admin/dispatch/suborders/${order.body.suborders[i].suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID()}` }).expect(201);
      const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID()}` }).expect(201);
      const offers = await get('/api/v1/riders/me/dispatch-offers', riders[i]).expect(200);
      const token = offers.body.items.find((o: any) => o.offerId === offer.body.offerId)?.offerToken;
      expect(token).toBeTruthy();
      const accepted = await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, riders[i], { offerToken: token, commandKey: `accept-${randomUUID()}` }).expect(201);
      const pickup = await post(`/api/v1/riders/me/assignments/${accepted.body.assignmentId}/pickup`, riders[i], { commandKey: `pickup-${randomUUID()}` }).expect(201);
      deliveries.push(pickup.body.deliveryId);
    }
    // Seed four expired challenges in the last hour, two per delivery; each
    // delivery has one issue left and the shared recipient has one slot left.
    await asSuper(u.privileged, async c => {
      for (const deliveryId of deliveries) for (let sequence = 1; sequence <= 2; sequence++) {
        const id = randomUUID();
        await c.query(`INSERT INTO "DeliveryOtpChallenge"(id,"deliveryId","recipientId",sequence,"codeHash","maxAttempts",channel,"commandKey","payloadHash","issuedAt","expiresAt") VALUES ($1,$2,$3,$4,$5,5,'test',$6,$5,gs_dispatch_now()-interval '3 minutes',gs_dispatch_now()-interval '2 minutes')`, [id, deliveryId, recipient.body.recipientId, sequence, 'a'.repeat(64), `seed-${id}`]);
        await c.query(`UPDATE "DeliveryOtpChallenge" SET status='EXPIRED',"closedAt"=gs_dispatch_now()-interval '2 minutes' WHERE id=$1`, [id]);
      }
    });
    const holder = new pg.Client({ connectionString: u.privileged });
    const monitor = new pg.Client({ connectionString: u.privileged });
    await holder.connect(); await monitor.connect();
    const keys = [`issue-${randomUUID()}`, `issue-${randomUUID()}`];
    const paths = deliveries.map(id => `/api/v1/riders/me/deliveries/${id}/otp-challenges`);
    let first: Promise<any> | undefined; let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`delivery-otp-recipient:${recipient.body.recipientId.toLowerCase()}`]);
      first = post(paths[0], riders[0], { commandKey: keys[0] }).then((r: any) => r);
      second = post(paths[1], riders[1], { commandKey: keys[1] }).then((r: any) => r);
      const deadline = Date.now() + 4000; let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await monitor.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'`)).rows[0].n;
        if (waiters >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end(); await monitor.end();
    }
    const results = await Promise.all([first!, second!]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 409).body.code).toBe('OTP_RECIPIENT_RATE_LIMIT');
    const winner = results.findIndex(r => r.status === 201);
    const challengeId = results[winner].body.challengeId as string;
    expect(results[winner].body.duplicate).toBe(false);
    expect(otpSink.consume(challengeId)).toMatch(/^[0-9]{6}$/);
    const replay = await post(paths[winner], riders[winner], { commandKey: keys[winner] }).expect(201);
    expect(replay.body).toMatchObject({ challengeId, duplicate: true });
    expect(otpSink.consume(challengeId)).toBeNull();
    const rows = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "DeliveryOtpChallenge" WHERE "recipientId"=$1 AND "issuedAt">gs_dispatch_now()-interval '1 hour'`, [recipient.body.recipientId]));
    expect(rows.rows[0].n).toBe(5);
    const outbox = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "OutboxEvent" WHERE "aggregateId"=ANY($1::uuid[]) AND "eventType"='delivery.otp.issued'`, [deliveries]));
    expect(outbox.rows[0].n).toBe(1);
  }, 120000);

  it('serializes a rider’s verification limit across different deliveries', async () => {
    const rider = await makeUser('rider-otp-rate-race'); await prepareRider(rider, 'otp-rate-race');
    const challenges: { deliveryId: string; challengeId: string; code: string; verifyKey: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const { assignmentId } = await assignedDelivery(rider, 'SANDBOX_MANUAL');
      const pickup = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: `pickup-${randomUUID()}` }).expect(201);
      const deliveryId = pickup.body.deliveryId as string;
      const issued = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID()}` }).expect(201);
      const challengeId = issued.body.challengeId as string;
      const code = otpSink.consume(challengeId)!;
      const verifyKey = `verify-${randomUUID()}`;
      await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${challengeId}/verify`, rider, { code, commandKey: verifyKey }).expect(201);
      await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: `complete-${randomUUID()}` }).expect(201);
      challenges.push({ deliveryId, challengeId, code, verifyKey });
    }
    const path = (c: typeof challenges[number]) => `/api/v1/riders/me/deliveries/${c.deliveryId}/otp-challenges/${c.challengeId}/verify`;
    // Two successful verifies plus seven closed-challenge attempts leave one slot.
    for (let i = 0; i < 7; i++) {
      const response = await post(path(challenges[0]), rider, { code: challenges[0].code, commandKey: `closed-${randomUUID()}` }).expect(201);
      expect(response.body.outcome).toBe('LOCKED');
    }
    const holder = new pg.Client({ connectionString: u.privileged });
    const monitor = new pg.Client({ connectionString: u.privileged });
    await holder.connect(); await monitor.connect();
    let first: Promise<any> | undefined; let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`delivery-otp-attempt:${rider.userId.toLowerCase()}`]);
      first = post(path(challenges[0]), rider, { code: challenges[0].code, commandKey: `race-${randomUUID()}` }).then((r: any) => r);
      second = post(path(challenges[1]), rider, { code: challenges[1].code, commandKey: `race-${randomUUID()}` }).then((r: any) => r);
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await monitor.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'`)).rows[0].n;
        if (waiters >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(waiters).toBeGreaterThanOrEqual(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end(); await monitor.end();
    }
    const results = await Promise.all([first!, second!]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(results.find(r => r.status === 201).body.outcome).toBe('LOCKED');
    expect(results.find(r => r.status === 409).body.code).toBe('OTP_RATE_LIMIT');
    const total = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "DeliveryOtpAttempt" WHERE "actorUserId"=$1 AND "occurredAt">gs_dispatch_now()-interval '60 seconds'`, [rider.userId]));
    expect(total.rows[0].n).toBe(10);
    // Idempotent replay must still succeed at the limit and not add an attempt.
    const replay = await post(path(challenges[0]), rider, { code: challenges[0].code, commandKey: challenges[0].verifyKey }).expect(201);
    expect(replay.body).toMatchObject({ outcome: 'VALID', duplicate: true });
    const differentCode = challenges[0].code === '000000' ? '111111' : '000000';
    const conflict = await post(path(challenges[0]), rider, { code: differentCode, commandKey: challenges[0].verifyKey }).expect(409);
    expect(conflict.body.code).toBe('DELIVERY_IDEMPOTENCY_CONFLICT');
    const final = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "DeliveryOtpAttempt" WHERE "actorUserId"=$1`, [rider.userId]));
    expect(final.rows[0].n).toBe(10);
  }, 120000);

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
    const riskRows = await asSuper(u.privileged, async c => c.query(
      `SELECT c.id, c."subjectUserId", c.kind, c.status, s.code, s.summary
       FROM "RiskCase" c JOIN "RiskSignal" s ON s."caseId"=c.id
       WHERE c."subjectUserId"=$1 AND c.kind='ACCOUNT_ABUSE' AND c."producerKey" IS NOT NULL`, [rider.userId]));
    expect(riskRows.rowCount).toBe(1);
    expect(riskRows.rows[0].code).toBe('OTP_ABUSE_PATTERN');
    expect(riskRows.rows[0].status).toBe('OPEN');
    expect(riskRows.rows[0].summary.automatedEnforcement).toBe(false);
    expect(JSON.stringify(riskRows.rows[0].summary)).not.toContain(code);
    const buyerCases = await asSuper(u.privileged, async c => c.query(
      `SELECT id FROM "RiskCase" WHERE "subjectUserId"=$1 AND kind='ACCOUNT_ABUSE' AND "producerKey" IS NOT NULL`, [customer.userId]));
    expect(buyerCases.rowCount).toBe(0);
    const deliveryAfter = await asSuper(u.privileged, async c => (await c.query(`SELECT status FROM "Delivery" WHERE id=$1`, [deliveryId])).rows[0]);
    expect(deliveryAfter.status).toBe('PICKED_UP');
    const resend = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(resend.body.code).toBe('OTP_RESEND_COOLDOWN');
  });
});

describe('rider earnings and COD deposit ledger', () => {
  async function assignedDelivery(rider: any, paymentMethod: 'COD' | 'SANDBOX_MANUAL') {
    await asSuper(u.privileged, async c => c.query(`UPDATE "RiderShift" SET "status"='ENDED', "endedAt"=now(), "updatedAt"=now() WHERE "status"='ACTIVE' AND "riderId" IN (SELECT id FROM "RiderProfile" WHERE "userId" <> $1)`, [rider.userId]));
    const { orderId, suborderId } = await readySuborder(paymentMethod);
    await setDestination(orderId);
    await post(`/api/v1/orders/${orderId}/delivery-recipient`, customer, { name: 'Test Recipient', phone: '+8801712345678', commandKey: `recipient-${randomUUID().slice(0, 8)}` }).expect(201);
    const run = await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`, dispatchAdmin, { commandKey: `run-${randomUUID().slice(0, 8)}` }).expect(201);
    const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`, dispatchAdmin, { expectedVersion: 1, commandKey: `offer-${randomUUID().slice(0, 8)}` }).expect(201);
    const offers = await get('/api/v1/riders/me/dispatch-offers', rider).expect(200);
    const token = offers.body.items.find((o: any) => o.offerId === offer.body.offerId).offerToken;
    const accepted = await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`, rider, { offerToken: token, commandKey: `accept-${randomUUID().slice(0, 8)}` }).expect(201);
    return { orderId, suborderId, assignmentId: accepted.body.assignmentId as string };
  }
  async function completedCodDelivery(rider: any) {
    const { assignmentId, suborderId } = await assignedDelivery(rider, 'COD');
    const pickup = await post(`/api/v1/riders/me/assignments/${assignmentId}/pickup`, rider, { commandKey: `pickup-${randomUUID().slice(0, 8)}` }).expect(201);
    const deliveryId = pickup.body.deliveryId as string;
    const issued = await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`, rider, { commandKey: `otp-${randomUUID().slice(0, 8)}` }).expect(201);
    const code = otpSink.consume(issued.body.challengeId);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${issued.body.challengeId}/verify`, rider, { code, commandKey: `verify-${randomUUID().slice(0, 8)}` }).expect(201);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`, rider, { expectedVersion: 2, commandKey: `complete-${randomUUID().slice(0, 8)}` }).expect(201);
    return { deliveryId, suborderId };
  }
  it('posts immutable earning and COD custody journals once, and exposes separate wallet balances', async () => {
    const rider = await makeUser('rider-finance-wallet'); const riderId = await prepareRider(rider, 'finance-wallet');
    const { deliveryId } = await completedCodDelivery(rider);
    const wallet = await get('/api/v1/riders/me/wallet', rider).expect(200);
    const bdt = wallet.body.balances.find((b: any) => b.currency === 'BDT');
    expect(bdt.earningsPostedMinor).toBe('6000');
    expect(bdt.codCollectedMinor).toBe('1000');
    expect(bdt.codDueMinor).toBe('1000');
    expect(wallet.body.payoutEnabled).toBe(false);
    const rows = await asSuper(u.privileged, async c => c.query(`SELECT e."journalId" AS earning_journal, cc."journalId" AS cod_journal FROM "RiderEarning" e JOIN "CodCollection" cc ON cc."deliveryId"=e."deliveryId" WHERE e."deliveryId"=$1`, [deliveryId]));
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].earning_journal).not.toBe(rows.rows[0].cod_journal);
    const balanced = await asSuper(u.privileged, async c => c.query(`SELECT j.id, SUM(CASE WHEN l.side='DEBIT' THEN l."amountMinor" ELSE -l."amountMinor" END)::bigint AS net FROM "LedgerJournal" j JOIN "LedgerLine" l ON l."journalId"=j.id WHERE j.id=ANY($1::uuid[]) GROUP BY j.id`, [[rows.rows[0].earning_journal, rows.rows[0].cod_journal]]));
    expect(balanced.rows.every((r: any) => r.net === '0')).toBe(true);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "RiderEarning" SET "amountMinor"=1 WHERE "deliveryId"=$1`, [deliveryId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "CodCollection" WHERE "deliveryId"=$1`, [deliveryId]))).resolves.toMatchObject({ rowCount: 0 });
  });
  it('pending deposit evidence does not reduce COD due; scoped step-up verification allocates once and overpayment fails', async () => {
    const rider = await makeUser('rider-finance-deposit'); await prepareRider(rider, 'finance-deposit');
    await completedCodDelivery(rider);
    const reviewer = await makeUser('cod-deposit-reviewer'); await grantKeys(reviewer, ['finance:cod:review']);
    const evidenceHash = createHash('sha256').update(`deposit-evidence-${randomUUID()}`).digest('hex');
    const body = { amountMinor: '1000', currency: 'BDT', method: 'BANK', externalReference: `bank-${randomUUID()}`, evidenceHash, commandKey: `deposit-${randomUUID()}` };
    const submitted = await post('/api/v1/riders/me/cod-deposits', rider, body).expect(201);
    expect(submitted.body.status).toBe('PENDING_REVIEW');
    const before = (await get('/api/v1/riders/me/wallet', rider).expect(200)).body.balances.find((b: any) => b.currency === 'BDT');
    expect(before.codDueMinor).toBe('1000');
    await get(`/api/v1/admin/cod-deposits?countryId=${countryId}`, stranger).expect(403);
    const reviewBody = { expectedVersion: 1, decision: 'VERIFY', commandKey: `verify-dep-${randomUUID()}`, reason: 'trusted bank statement matched merchant account' };
    await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='MFA', "stepUpExpiresAt"=NULL WHERE id=$1`, [reviewer.sessionId]); });
    await post(`/api/v1/admin/cod-deposits/${submitted.body.depositId}/review`, reviewer, reviewBody).expect(403);
    await setStepUp(reviewer);
    const verified = await post(`/api/v1/admin/cod-deposits/${submitted.body.depositId}/review`, reviewer, reviewBody).expect(201);
    expect(verified.body.status).toBe('VERIFIED');
    expect(verified.body.journalId).toBeTruthy();
    const replay = await post(`/api/v1/admin/cod-deposits/${submitted.body.depositId}/review`, reviewer, reviewBody).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const after = (await get('/api/v1/riders/me/wallet', rider).expect(200)).body.balances.find((b: any) => b.currency === 'BDT');
    expect(after.codDueMinor).toBe('0');
    expect(after.codVerifiedDepositsMinor).toBe('1000');
    const over = await post('/api/v1/riders/me/cod-deposits', rider, { ...body, externalReference: `bank-${randomUUID()}`, commandKey: `deposit-${randomUUID()}` }).expect(201);
    const overReview = await post(`/api/v1/admin/cod-deposits/${over.body.depositId}/review`, reviewer, { expectedVersion: 1, decision: 'VERIFY', commandKey: `verify-dep-${randomUUID()}`, reason: 'attempted overpayment verification' }).expect(409);
    expect(overReview.body.code).toBe('COD_DEPOSIT_EXCEEDS_DUE');
    const allocs = await asSuper(u.privileged, async c => c.query(`SELECT COUNT(*)::int AS n FROM "CodAllocation" WHERE "depositId"=$1`, [submitted.body.depositId]));
    expect(allocs.rows[0].n).toBe(1);
  });
  it('rejects deposit evidence without a journal and denies self-review', async () => {
    const rider = await makeUser('rider-finance-reject'); await prepareRider(rider, 'finance-reject');
    await completedCodDelivery(rider);
    const reviewer = await makeUser('cod-deposit-rejector'); await grantKeys(reviewer, ['finance:cod:review']);
    const dep = await post('/api/v1/riders/me/cod-deposits', rider, { amountMinor: '500', currency: 'BDT', method: 'COMPANY_OFFICE', externalReference: `office-${randomUUID()}`, evidenceHash: createHash('sha256').update(randomUUID()).digest('hex'), commandKey: `deposit-${randomUUID()}` }).expect(201);
    await grantKeys(rider, ['finance:cod:review']);
    const self = await post(`/api/v1/admin/cod-deposits/${dep.body.depositId}/review`, rider, { expectedVersion: 1, decision: 'VERIFY', commandKey: `self-${randomUUID()}`, reason: 'self review attempt must fail' }).expect(403);
    expect(self.body.code).toBe('SELF_REVIEW_DENIED');
    const rejected = await post(`/api/v1/admin/cod-deposits/${dep.body.depositId}/review`, reviewer, { expectedVersion: 1, decision: 'REJECT', commandKey: `reject-${randomUUID()}`, reason: 'evidence does not match company records' }).expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.journalId).toBeNull();
    const wallet = (await get('/api/v1/riders/me/wallet', rider).expect(200)).body.balances.find((b: any) => b.currency === 'BDT');
    expect(wallet.codDueMinor).toBe('1000');
  });
});

describe('rider rate rule management', () => {
  it('requires permission + step-up + scope, validates contiguous slabs, and replays idempotently', async () => {
    const manager = await makeUser('rate-manager'); await grantKeys(manager, ['finance:rider-rate:manage']);
    const effectiveFrom = new Date(Date.now() + 24 * 3600_000).toISOString();
    const body = { countryId, currency: 'BDT', effectiveFrom, commandKey: `rate-${randomUUID().slice(0, 8)}`, slabs: [{ lowerMeters: 0, upperMeters: 1500, amountMinor: '5000' }, { lowerMeters: 1500, upperMeters: null, amountMinor: '8000' }] };
    await post('/api/v1/admin/rider-rate-rules', stranger, body).expect(403);
    const gap = { ...body, commandKey: `rate-${randomUUID().slice(0, 8)}`, slabs: [{ lowerMeters: 0, upperMeters: 1000, amountMinor: '5000' }, { lowerMeters: 2000, upperMeters: null, amountMinor: '8000' }] };
    const gapRes = await post('/api/v1/admin/rider-rate-rules', manager, gap).expect(400);
    expect(gapRes.body.code).toBe('RATE_SLABS_GAP');
    await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='MFA', "stepUpExpiresAt"=NULL WHERE id=$1`, [manager.sessionId]); });
    const step = await post('/api/v1/admin/rider-rate-rules', manager, body).expect(403);
    expect(step.body.code).toBe('STEP_UP_REQUIRED');
    await setStepUp(manager);
    const created = await post('/api/v1/admin/rider-rate-rules', manager, body).expect(201);
    expect(created.body.ruleId).toBeTruthy(); expect(created.body.duplicate).toBe(false);
    const replay = await post('/api/v1/admin/rider-rate-rules', manager, body).expect(201);
    expect(replay.body.ruleId).toBe(created.body.ruleId); expect(replay.body.duplicate).toBe(true);
    const conflict = await post('/api/v1/admin/rider-rate-rules', manager, { ...body, currency: 'USD' }).expect(409);
    expect(conflict.body.code).toBe('RATE_IDEMPOTENCY_CONFLICT');
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "RiderRateSlab" SET "amountMinor"=1 WHERE "ruleId"=$1`, [created.body.ruleId]))).rejects.toThrow(/permission denied|append_only/);
  });
});

describe('vendor settlement maker-checker with verified destination', () => {
  async function fixture(label: string, holdDays = 0) {
    const maker = await makeUser(`${label}-maker`); await grantKeys(maker, ['finance:commission:manage','finance:settlement:prepare','finance:settlement:review']);
    const checker = await makeUser(`${label}-checker`); await grantKeys(checker, ['finance:settlement:review']);
    const policy = await post('/api/v1/admin/vendor-commission-policies', maker, { vendorId, commissionBps: 1000, holdDays, effectiveFrom: new Date(Date.now()-3600_000).toISOString(), commandKey: `policy-${randomUUID()}` }).expect(201);
    const rider = await makeUser(`${label}-rider`); await prepareRider(rider,label);
    await asSuper(u.privileged, c => c.query(`UPDATE "RiderShift" SET "status"='ENDED',"endedAt"=now(),"updatedAt"=now() WHERE "status"='ACTIVE' AND "riderId" <> (SELECT id FROM "RiderProfile" WHERE "userId"=$1)`,[rider.userId]));
    const { orderId, suborderId } = await readySuborder('COD'); await setDestination(orderId);
    await post(`/api/v1/orders/${orderId}/delivery-recipient`,customer,{name:'TEST Recipient',phone:'+8801712345678',commandKey:`recipient-${randomUUID()}`}).expect(201);
    const run = await post(`/api/v1/admin/dispatch/suborders/${suborderId}/runs`,dispatchAdmin,{commandKey:`run-${randomUUID()}`}).expect(201);
    const offer = await post(`/api/v1/admin/dispatch/runs/${run.body.runId}/next-offer`,dispatchAdmin,{expectedVersion:1,commandKey:`offer-${randomUUID()}`}).expect(201);
    const token = (await get('/api/v1/riders/me/dispatch-offers',rider).expect(200)).body.items.find((o:any)=>o.offerId===offer.body.offerId).offerToken;
    const assignment = await post(`/api/v1/riders/me/dispatch-offers/${offer.body.offerId}/accept`,rider,{offerToken:token,commandKey:`accept-${randomUUID()}`}).expect(201);
    const pickup = await post(`/api/v1/riders/me/assignments/${assignment.body.assignmentId}/pickup`,rider,{commandKey:`pickup-${randomUUID()}`}).expect(201);
    const deliveryId=pickup.body.deliveryId;
    const otp=await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges`,rider,{commandKey:`otp-${randomUUID()}`}).expect(201);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/otp-challenges/${otp.body.challengeId}/verify`,rider,{code:otpSink.consume(otp.body.challengeId),commandKey:`verify-${randomUUID()}`}).expect(201);
    await post(`/api/v1/riders/me/deliveries/${deliveryId}/complete`,rider,{expectedVersion:2,commandKey:`complete-${randomUUID()}`}).expect(201);
    await setStepUp(owner);
    const proof=randomUUID(); await asSuper(u.privileged,c=>c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,'payout-destination-proof',$3,'application/pdf',100,$4,'UPLOADED',true,'local-dev-aes-256-gcm',now())`,[proof,owner.userId,`payout-proof/${proof}`,'a'.repeat(64)]));
    const dest=await post(`/api/v1/vendors/${vendorId}/payout-destinations`,owner,{countryId,currency:'BDT',rail:'BANK',accountHolderName:'TEST ONLY Vendor',accountNumber:`000${randomUUID().replaceAll('-','').slice(0,12)}`,institutionName:'TEST ONLY Bank',proofStorageObjectId:proof,commandKey:`destination-${randomUUID()}`}).expect(201);
    const destReviewer=await makeUser(`${label}-dest-reviewer`); await grantKeys(destReviewer,['finance:payout-destination:review']);
    await post(`/api/v1/admin/payout-destinations/${dest.body.destinationId}/review`,destReviewer,{expectedVersion:1,decision:'VERIFY',verificationReference:`trusted-${randomUUID()}`,reason:'synthetic account ownership verified',commandKey:`review-${randomUUID()}`}).expect(201);
    return {maker,checker,rider,orderId,suborderId,deliveryId,destinationId:dest.body.destinationId,policyId:policy.body.policyId};
  }
  function prepareBody(f:any){return {vendorId,destinationId:f.destinationId,suborderIds:[f.suborderId],commandKey:`settlement-${randomUUID()}`};}
  it('blocks unpaid COD and destination cooldown, then reserves payable exactly once after verified deposit',async()=>{
    const f=await fixture('settlement-cod'); const body=prepareBody(f);
    const cooldownNow=await post('/api/v1/admin/vendor-settlements',f.maker,body).expect(409); expect(cooldownNow.body.code).toBe('PAYOUT_DESTINATION_REQUIRED');
    const wallet=await get('/api/v1/riders/me/wallet',f.rider).expect(200); const dueAmount=wallet.body.balances.find((b:any)=>b.currency==='BDT').codDueMinor;
    const deposit=await post('/api/v1/riders/me/cod-deposits',f.rider,{amountMinor:dueAmount,currency:'BDT',method:'BANK',externalReference:`bank-${randomUUID()}`,evidenceHash:createHash('sha256').update(randomUUID()).digest('hex'),commandKey:`deposit-${randomUUID()}`}).expect(201);
    const codChecker=await makeUser('settlement-cod-checker'); await grantKeys(codChecker,['finance:cod:review']);
    await post(`/api/v1/admin/cod-deposits/${deposit.body.depositId}/review`,codChecker,{expectedVersion:1,decision:'VERIFY',reason:'trusted synthetic bank record matched',commandKey:`verify-${randomUUID()}`}).expect(201);
    const cooldown=await post('/api/v1/admin/vendor-settlements',f.maker,body).expect(409); expect(cooldown.body.code).toBe('PAYOUT_DESTINATION_REQUIRED');
    const clock=vi.spyOn(app.get(VendorSettlementsService),'now').mockReturnValue(new Date(Date.now()+50*3600_000));
    try {
      await post('/api/v1/admin/vendor-settlements',stranger,body).expect(403);
      const prepared=await post('/api/v1/admin/vendor-settlements',f.maker,body).expect(201); const id=prepared.body.settlementId;
      expect(prepared.body).toMatchObject({grossMinor:'1000',commissionMinor:'100',netMinor:'900',status:'PENDING_REVIEW',execution:'DISABLED',moneyMoved:false});
      expect((await post('/api/v1/admin/vendor-settlements',f.maker,body).expect(201)).body.duplicate).toBe(true);
      const review={expectedVersion:1,decision:'APPROVE',commandKey:`approve-${randomUUID()}`,reason:'independently checked synthetic settlement'};
      expect((await post(`/api/v1/admin/vendor-settlements/${id}/review`,f.maker,review).expect(403)).body.code).toBe('SELF_REVIEW_DENIED');
      const approved=await post(`/api/v1/admin/vendor-settlements/${id}/review`,f.checker,review); if(approved.status!==201) console.error('settlement-approval',approved.body); expect(approved.status).toBe(201); expect(approved.body.status).toBe('APPROVED'); expect(approved.body.moneyMoved).toBe(false);
      expect((await post(`/api/v1/admin/vendor-settlements/${id}/review`,f.checker,review).expect(201)).body.duplicate).toBe(true);
      const journal=await asSuper(u.privileged,c=>c.query(`SELECT SUM(CASE WHEN l.side='DEBIT' THEN l."amountMinor" ELSE -l."amountMinor" END)::bigint AS net,COUNT(*)::int AS n FROM "LedgerLine" l WHERE l."journalId"=$1`,[approved.body.journalId])); expect(journal.rows[0]).toMatchObject({net:'0',n:3});
      const other=await post('/api/v1/admin/vendor-settlements',f.maker,{...body,commandKey:`settlement-${randomUUID()}`}).expect(409);expect(other.body.code).toBe('SETTLEMENT_SUBORDER_ALREADY_ALLOCATED');
      const mine=await get(`/api/v1/vendors/${vendorId}/settlements`,owner).expect(200);expect(mine.body.items.some((s:any)=>s.settlementId===id)).toBe(true);
      await expect(asUser(u.runtime,stranger.userId,c=>c.query(`SELECT id FROM "VendorSettlement" WHERE id=$1`,[id]))).resolves.toMatchObject({rowCount:0});
      await expect(asSuper(u.privileged,c=>c.query(`UPDATE "VendorSettlementItem" SET "netMinor"=1 WHERE "settlementId"=$1`,[id]))).rejects.toThrow(/permission denied|append_only/);
      await grantKeys(f.maker,['finance:adjustment:prepare','finance:adjustment:review','finance:payout:prepare','finance:payout:execute','finance:reconciliation:import']);
      await grantKeys(f.checker,['finance:adjustment:review']);
      const evidence=createHash('sha256').update(randomUUID()).digest('hex');
      const adjustment=await post(`/api/v1/admin/vendor-settlements/${id}/adjustments`,f.maker,{amountMinor:'-50',reason:'verified sandbox fee correction',evidenceHash:evidence,commandKey:`adjust-${randomUUID()}`}).expect(201);
      await post(`/api/v1/admin/finance-adjustments/${adjustment.body.adjustmentId}/review`,f.maker,{expectedVersion:1,decision:'APPROVE',reason:'independent adjustment check',commandKey:`adjust-review-${randomUUID()}`}).expect(409);
      await post(`/api/v1/admin/finance-adjustments/${adjustment.body.adjustmentId}/review`,f.checker,{expectedVersion:1,decision:'APPROVE',reason:'independent adjustment check',commandKey:`adjust-review-${randomUUID()}`}).expect(201);
      const opsClock=vi.spyOn(app.get(FinanceOperationsService),'now').mockReturnValue(new Date(Date.now()+51*3600_000));
      try {
        const reserved=await post(`/api/v1/admin/vendor-settlements/${id}/payout-reservations`,f.maker,{commandKey:`reserve-${randomUUID()}`}).expect(201);expect(reserved.body.amountMinor).toBe('850');expect(reserved.body.status).toBe('RESERVED');expect(reserved.body.liveEnabled).toBe(false);
        const payoutId=reserved.body.id;
        const unknown=await post(`/api/v1/admin/sandbox-transfers/payouts/${payoutId}/submit`,f.maker,{commandKey:`unknown-${randomUUID()}`,simulateUnknown:true}).expect(201);expect(unknown.body.status).toBe('RESERVED');
        const submit={commandKey:`submit-${randomUUID()}`};const submitted=await post(`/api/v1/admin/sandbox-transfers/payouts/${payoutId}/submit`,f.maker,submit).expect(201);expect(submitted.body.status).toBe('SUBMITTED');
        expect((await post(`/api/v1/admin/sandbox-transfers/payouts/${payoutId}/submit`,f.maker,submit).expect(201)).body.duplicate).toBe(true);
        const statement={status:'SUCCEEDED',statementReference:`stmt-${randomUUID()}`,evidenceHash:evidence,commandKey:`reconcile-${randomUUID()}`};
        const done=await post(`/api/v1/admin/sandbox-transfers/payouts/${payoutId}/reconcile`,f.maker,statement).expect(201);expect(done.body.transfer.status).toBe('SUCCEEDED');expect(done.body.transfer.moneyMoved).toBe(false);
        expect((await post(`/api/v1/admin/sandbox-transfers/payouts/${payoutId}/reconcile`,f.maker,statement).expect(201)).body.duplicate).toBe(true);
        const detail=await get(`/api/v1/sandbox-transfers/payouts/${payoutId}`,owner).expect(200);expect(detail.body.attempts.map((a:any)=>a.outcome)).toEqual(['UNKNOWN','SUBMITTED']);
        await post(`/api/v1/admin/vendor-settlements/${id}/adjustments`,f.maker,{amountMinor:'1',reason:'late adjustment must fail',evidenceHash:evidence,commandKey:`late-${randomUUID()}`}).expect(409);
      } finally {opsClock.mockRestore();}
    } finally {clock.mockRestore();}
  });
  it('enforces the configured hold and allows terminal rejection without a journal',async()=>{
    const f=await fixture('settlement-hold',7);
    const dep=await post('/api/v1/riders/me/cod-deposits',f.rider,{amountMinor:'1000',currency:'BDT',method:'COMPANY_OFFICE',externalReference:`office-${randomUUID()}`,evidenceHash:createHash('sha256').update(randomUUID()).digest('hex'),commandKey:`deposit-${randomUUID()}`}).expect(201);
    const checker=await makeUser('hold-cod-checker');await grantKeys(checker,['finance:cod:review']);await post(`/api/v1/admin/cod-deposits/${dep.body.depositId}/review`,checker,{expectedVersion:1,decision:'VERIFY',reason:'office cash receipt independently matched',commandKey:`verify-${randomUUID()}`}).expect(201);
    const clock=vi.spyOn(app.get(VendorSettlementsService),'now').mockReturnValue(new Date(Date.now()+50*3600_000));
    try{
      expect((await post('/api/v1/admin/vendor-settlements',f.maker,prepareBody(f)).expect(409)).body.code).toBe('SETTLEMENT_HOLD_ACTIVE');
      clock.mockReturnValue(new Date(Date.now()+8*86400_000));
      const prepared=await post('/api/v1/admin/vendor-settlements',f.maker,prepareBody(f)).expect(201);
      const rejected=await post(`/api/v1/admin/vendor-settlements/${prepared.body.settlementId}/review`,f.checker,{expectedVersion:1,decision:'REJECT',commandKey:`reject-${randomUUID()}`,reason:'source documents require correction'}).expect(201);
      expect(rejected.body.status).toBe('REJECTED');expect(rejected.body.journalId).toBeNull();
      const retried=await post('/api/v1/admin/vendor-settlements',f.maker,{...prepareBody(f),commandKey:`settlement-${randomUUID()}`}).expect(201);expect(retried.body.settlementId).not.toBe(prepared.body.settlementId);
      await expect(asSuper(u.privileged,async c=>{await c.query(`SELECT set_config('app.user_id',$1,true)`,[f.checker.userId]);await c.query(`SELECT set_config('app.is_super','true',true)`);await c.query(`UPDATE "VendorSettlement" SET status='REJECTED',version=2,"reviewedByUserId"=$1,"reviewedAt"=now(),"reviewCommandKey"='bypass-review-key',"reviewPayloadHash"='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',"reviewReason"='attempted bypass' WHERE id=$2`,[f.checker.userId,retried.body.settlementId]);})).rejects.toThrow(/settlement_review_required/);
    }finally{clock.mockRestore();}
  });
});

describe('recipient and destination write consistency', () => {
  async function pendingCodOrder() {
    let { cartId, version } = await clearCart();
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId, quantity: 1, expectedVersion: version }).expect(201);
    version = added.body.version;
    const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: version, destinationCityId: cityId, commandKey: `details-quote-${randomUUID()}` }).expect(201);
    return (await post('/api/v1/orders', customer, { quoteId: quote.body.quoteId, expectedQuoteVersion: quote.body.version, commandKey: `details-order-${randomUUID()}`, paymentMethod: 'COD' }).expect(201)).body;
  }
  async function waitForOrderWaiters(monitor: pg.Client, count: number) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const n = (await monitor.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%FROM "Order"%FOR UPDATE%'`)).rows[0].n;
      if (n >= count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Expected ${count} blocked order operations`);
  }
  const bodyFor = (kind: 'recipient' | 'destination') => kind === 'recipient'
    ? { name: 'Example Recipient', phone: '+8801712345678', commandKey: `recipient-${randomUUID()}` }
    : { serviceZoneId: zoneId, boundaryVersionId: boundaryId, latitude: 24.751, longitude: 90.401, addressLine: 'Example private delivery address', commandKey: `destination-${randomUUID()}` };
  async function race(kind: 'recipient' | 'destination', changed: boolean) {
    const order = await pendingCodOrder();
    const path = `/api/v1/orders/${order.orderId}/delivery-${kind}`;
    const body = bodyFor(kind);
    const other = changed ? { ...body, ...(kind === 'recipient' ? { name: 'Different Recipient' } : { addressLine: 'Another private delivery address' }) } : body;
    await post(path, stranger, body).expect(404);
    const holder = new pg.Client({ connectionString: u.privileged });
    const monitor = new pg.Client({ connectionString: u.privileged });
    await holder.connect(); await monitor.connect();
    let first: Promise<any> | undefined; let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "Order" WHERE id=$1 FOR UPDATE', [order.orderId]);
      first = post(path, customer, body).then((r: any) => r);
      await waitForOrderWaiters(monitor, 1);
      second = post(path, customer, other).then((r: any) => r);
      await waitForOrderWaiters(monitor, 2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end(); await monitor.end();
    }
    const [a, b] = await Promise.all([first!, second!]);
    expect(a.status).toBe(201);
    expect(a.body.duplicate).toBe(false);
    if (changed) {
      expect(b.status).toBe(409);
      expect(b.body.code).toBe(kind === 'recipient' ? 'RECIPIENT_ALREADY_SET' : 'DESTINATION_ALREADY_SET');
    } else {
      expect(b.status).toBe(201);
      expect(b.body.duplicate).toBe(true);
      expect(b.body[kind === 'recipient' ? 'recipientId' : 'destinationId']).toBe(a.body[kind === 'recipient' ? 'recipientId' : 'destinationId']);
    }
    const row = await asSuper(u.privileged, c => c.query(kind === 'recipient'
      ? 'SELECT id,"contactEnvelope" FROM "DeliveryRecipient" WHERE "orderId"=$1'
      : 'SELECT id,"addressLine" FROM "OrderDeliveryDestination" WHERE "orderId"=$1', [order.orderId]));
    expect(row.rowCount).toBe(1);
    const hidden = await asUser(u.runtime, stranger.userId, c => c.query(kind === 'recipient'
      ? 'SELECT id FROM "DeliveryRecipient" WHERE "orderId"=$1'
      : 'SELECT id FROM "OrderDeliveryDestination" WHERE "orderId"=$1', [order.orderId]));
    expect(hidden.rowCount).toBe(0);
    if (kind === 'recipient') {
      expect(a.body.maskedPhone).toBe('******5678');
      expect(row.rows[0].contactEnvelope.toString()).not.toContain('Example Recipient');
      expect(row.rows[0].contactEnvelope.toString()).not.toContain('+8801712345678');
    } else expect(row.rows[0].addressLine).toBe('Example private delivery address');
    const action = kind === 'recipient' ? 'commerce.order.recipient_set' : 'commerce.order.destination_set';
    const auditResource = kind === 'recipient' ? row.rows[0].id : order.orderId;
    const eventKey = kind === 'recipient' ? `order-recipient-${order.orderId}` : `order-destination-${order.orderId}`;
    const effects = await asSuper(u.privileged, c => c.query(`SELECT
      (SELECT count(*)::int FROM "AuditLog" WHERE "resourceId"=$1 AND action=$2) AS audits,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "eventKey"=$3) AS events,
      (SELECT payload::text FROM "OutboxEvent" WHERE "eventKey"=$3) AS payload`, [auditResource, action, eventKey]));
    expect(effects.rows[0]).toMatchObject({ audits: 1, events: 1 });
    expect(effects.rows[0].payload).not.toContain('Example Recipient');
    expect(effects.rows[0].payload).not.toContain('+8801712345678');
    expect(effects.rows[0].payload).not.toContain('Example private delivery address');
  }
  for (const kind of ['recipient', 'destination'] as const) {
    it(`replays an overlapping ${kind} submission exactly once`, async () => { await race(kind, false); });
    it(`rejects an overlapping changed ${kind} submission`, async () => { await race(kind, true); });
  }

  it('does not add contact or destination after an overlapping cancellation wins', async () => {
    const order = await pendingCodOrder();
    const holder = new pg.Client({ connectionString: u.privileged });
    const monitor = new pg.Client({ connectionString: u.privileged });
    await holder.connect(); await monitor.connect();
    let cancellation: Promise<any> | undefined; let recipient: Promise<any> | undefined; let destination: Promise<any> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "Order" WHERE id=$1 FOR UPDATE', [order.orderId]);
      cancellation = post(`/api/v1/orders/${order.orderId}/cancellation`, customer, { expectedVersion: order.version, commandKey: `cancel-${randomUUID()}`, reason: 'cancel order before delivery setup' }).then((r: any) => r);
      await waitForOrderWaiters(monitor, 1);
      recipient = post(`/api/v1/orders/${order.orderId}/delivery-recipient`, customer, bodyFor('recipient')).then((r: any) => r);
      destination = post(`/api/v1/orders/${order.orderId}/delivery-destination`, customer, bodyFor('destination')).then((r: any) => r);
      await waitForOrderWaiters(monitor, 3);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end(); await monitor.end();
    }
    const [cancelled, contactResult, destinationResult] = await Promise.all([cancellation!, recipient!, destination!]);
    expect(cancelled.status).toBe(201);
    for (const result of [contactResult, destinationResult]) {
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('ORDER_NOT_ACTIVE');
    }
    const rows = await asSuper(u.privileged, c => c.query(`SELECT
      (SELECT count(*)::int FROM "DeliveryRecipient" WHERE "orderId"=$1) AS recipients,
      (SELECT count(*)::int FROM "OrderDeliveryDestination" WHERE "orderId"=$1) AS destinations`, [order.orderId]));
    expect(rows.rows[0]).toEqual({ recipients: 0, destinations: 0 });
  });
});
