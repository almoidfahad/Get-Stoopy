import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, asUser } from './helpers';
import { signSandboxWebhook } from '../../packages/core/src/payment';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
const webhookSecret = 'fulfillment-sandbox-webhook-secret-0000';
let countryId: string;
let cityId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-fulfillment-test-${randomUUID()}`;
let customer: any;
let stranger: any;
let owner: any;
let managerA: any;
let staffA: any;
let managerB: any;
let vendorId: string;
let storeA: string;
let storeB: string;
let variantA: string;
let variantB: string;
let codAdmin: any;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `fulfillment-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Fulfillment ${label}`]);
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
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `fulfillment-role-${randomUUID()}`, 'Fulfillment Role']);
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
  const id = randomUUID(); const hash = createHash('sha256').update(`fulfillment-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return id;
}
async function drainOutbox() {
  for (let i = 0; i < 25; i++) {
    const pending = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(), "leaseToken"=NULL, "leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`);
    if ((pending.rowCount ?? 0) === 0) return;
    await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName });
  }
}
async function clearCart() {
  const cart = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
  const cartId = cart.body.cartId;
  let current = await get(`/api/v1/commerce/carts/${cartId}`, customer).expect(200);
  for (const item of current.body.items) {
    current = await request(app.getHttpServer()).delete(`/api/v1/commerce/carts/${cartId}/items/${item.variantId}?expectedVersion=${current.body.version}`).set('Cookie', `gs_session_dev=${customer.token}`).set('Origin', origin).set('X-CSRF-Token', customer.csrf).expect(200);
  }
  return { cartId, version: current.body.version as number };
}
async function createOrder(lines: { variantId: string; quantity: number }[], paymentMethod: 'COD' | 'SANDBOX_MANUAL') {
  let { cartId, version } = await clearCart();
  for (const line of lines) {
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: line.variantId, quantity: line.quantity, expectedVersion: version }).expect(201);
    version = added.body.version;
  }
  const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: version, destinationCityId: cityId, commandKey: `quote-${randomUUID().slice(0, 8)}` }).expect(201);
  const order = await post('/api/v1/orders', customer, { quoteId: quote.body.quoteId, expectedQuoteVersion: quote.body.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod }).expect(201);
  return order.body;
}
function webhook(body: unknown) {
  const raw = JSON.stringify(body); const timestamp = String(Math.floor(Date.now() / 1000));
  return request(app.getHttpServer()).post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-gs-timestamp', timestamp).set('x-gs-signature', signSandboxWebhook(webhookSecret, timestamp, raw)).send(raw);
}
async function setupStore(label: string, price: string) {
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: `Fulfillment Store ${label}`, slug: `fulfillment-store-${label}-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  const storeId = store.body.storeId as string;
  const storeAdmin = await makeUser(`store-admin-${label}`); await grantKeys(storeAdmin, ['catalog:store:activate']);
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: `Fulfillment Product ${label}`, description: 'A product used for fulfillment integration tests', brand: 'Stoopy' }).expect(201);
  const productId = product.body.productId;
  const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `FUL-${label}-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: price, currency: 'BDT' }).expect(201);
  const variantId = variant.body.id as string;
  const productModerator = await makeUser(`product-moderator-${label}`); await grantKeys(productModerator, ['catalog:product:review', 'catalog:product:publish']);
  await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/review`, productModerator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/publish`, productModerator, { version: 3, reason: 'approved for public catalog' }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 0 }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 100, commandKey: `stock-${variantId}`, reason: 'initial fulfillment test stock' }).expect(201);
  return { storeId, variantId };
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  process.env['PAYMENTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYMENT_SANDBOX_WEBHOOK_SECRET'] = webhookSecret; process.env['PAYMENTS_LIVE_ENABLED'] = 'false';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `ful-reg-${randomUUID().slice(0, 8)}`, 'Fulfillment', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `ful-dist-${randomUUID().slice(0, 8)}`, 'Fulfillment', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `ful-city-${randomUUID().slice(0, 8)}`, 'Fulfillment', 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();
  customer = await makeUser('customer'); stranger = await makeUser('stranger');
  const kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  codAdmin = await makeUser('cod-admin'); await grantKeys(codAdmin, ['finance:cod:manage']);
  const existingPolicy = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "CodPolicy" WHERE "countryId"=$1`, [countryId])).rows[0]);
  await put('/api/v1/admin/cod-policy', codAdmin, { countryId, enabled: true, maxOrderMinor: '100000', ...(existingPolicy ? { version: existingPolicy.version } : {}) }).expect(200);
  owner = await makeUser('owner'); await setStepUp(owner);
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Fulfillment Vendor' }).expect(201);
  vendorId = vendor.body.vendorId;
  const kyc = await post('/api/v1/kyc/cases', owner, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const kycCaseId = kyc.body.caseId;
  const docId = await makeStorageObject(owner.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, owner, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const a = await setupStore('a', '1000'); storeA = a.storeId; variantA = a.variantId;
  const b = await setupStore('b', '500'); storeB = b.storeId; variantB = b.variantId;
  managerA = await makeUser('manager-a'); staffA = await makeUser('staff-a'); managerB = await makeUser('manager-b');
  await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: managerA.userId, role: 'MANAGER', storeId: storeA }).expect(201);
  await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: staffA.userId, role: 'STAFF', storeId: storeA }).expect(201);
  await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: managerB.userId, role: 'MANAGER', storeId: storeB }).expect(201);
}, 120000);
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('vendor suborder fulfillment readiness', () => {
  it('runs COD accept → start preparation → manual ready with idempotency, versioning and append-only history', async () => {
    const order = await createOrder([{ variantId: variantA, quantity: 1 }, { variantId: variantB, quantity: 1 }], 'COD');
    expect(order.suborders).toHaveLength(2);
    const sub = order.suborders.find((s: any) => s.storeId === storeA);
    expect(sub.status).toBe('PENDING_VENDOR');
    const acceptKey = `accept-${randomUUID().slice(0, 8)}`;
    const accepted = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, managerA, { expectedVersion: 1, commandKey: acceptKey, preparationMinutes: 30 }).expect(201);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(accepted.body.version).toBe(2);
    expect(accepted.body.preparationMinutes).toBe(30);
    const replay = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, managerA, { expectedVersion: 1, commandKey: acceptKey, preparationMinutes: 30 }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const conflict = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, managerA, { expectedVersion: 1, commandKey: acceptKey, preparationMinutes: 45 }).expect(409);
    expect(conflict.body.code).toBe('FULFILLMENT_IDEMPOTENCY_CONFLICT');
    const stale = await post(`/api/v1/vendor/suborders/${sub.suborderId}/start-preparation`, managerA, { expectedVersion: 1, commandKey: `prep-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(stale.body.code).toBe('SUBORDER_VERSION_CONFLICT');
    const skip = await post(`/api/v1/vendor/suborders/${sub.suborderId}/ready`, managerA, { expectedVersion: 2, commandKey: `ready-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(skip.body.code).toBe('SUBORDER_INVALID_TRANSITION');
    const preparing = await post(`/api/v1/vendor/suborders/${sub.suborderId}/start-preparation`, managerA, { expectedVersion: 2, commandKey: `prep-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(preparing.body.status).toBe('PREPARING');
    const ready = await post(`/api/v1/vendor/suborders/${sub.suborderId}/ready`, managerA, { expectedVersion: 3, commandKey: `ready-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(ready.body.status).toBe('READY_FOR_PICKUP');
    expect(ready.body.readyConfirmedAt).toBeTruthy();
    const history = await get(`/api/v1/vendor/suborders/${sub.suborderId}/history`, managerA).expect(200);
    expect(history.body.items.map((e: any) => e.toStatus)).toEqual(['READY_FOR_PICKUP', 'PREPARING', 'ACCEPTED']);
    const buyerOrder = await get(`/api/v1/orders/${order.orderId}`, customer).expect(200);
    expect(buyerOrder.body.suborders.find((s: any) => s.suborderId === sub.suborderId).status).toBe('READY_FOR_PICKUP');
    const eventId = history.body.items[0].id as string;
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "VendorSuborderStatusEvent" SET reason='tampered' WHERE id=$1`, [eventId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "VendorSuborderStatusEvent" WHERE id=$1`, [eventId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asUser(u.runtime, managerA.userId, c => c.query(`UPDATE "VendorSuborder" SET status='REJECTED' WHERE id=$1`, [sub.suborderId]))).rejects.toThrow(/permission denied/);
  });

  it('enforces store-scoped membership, read-only staff and foreign-vendor isolation', async () => {
    const order = await createOrder([{ variantId: variantA, quantity: 1 }, { variantId: variantB, quantity: 1 }], 'COD');
    const subA = order.suborders.find((s: any) => s.storeId === storeA);
    const subB = order.suborders.find((s: any) => s.storeId === storeB);
    await get(`/api/v1/vendor/suborders/${subA.suborderId}`, managerA).expect(200);
    await get(`/api/v1/vendor/suborders/${subB.suborderId}`, managerA).expect(404);
    await get(`/api/v1/vendor/suborders/${subA.suborderId}`, staffA).expect(200);
    await post(`/api/v1/vendor/suborders/${subA.suborderId}/accept`, staffA, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 15 }).expect(403);
    await get(`/api/v1/vendor/suborders/${subA.suborderId}`, stranger).expect(404);
    await post(`/api/v1/vendor/suborders/${subA.suborderId}/accept`, stranger, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 15 }).expect(404);
    await get(`/api/v1/vendor/stores/${storeB}/suborders`, managerA).expect(404);
    const listB = await get(`/api/v1/vendor/stores/${storeB}/suborders`, managerB).expect(200);
    expect(listB.body.items.some((s: any) => s.suborderId === subB.suborderId)).toBe(true);
    const visible = await asUser(u.runtime, managerA.userId, c => c.query(`SELECT id FROM "VendorSuborder" WHERE id=$1`, [subB.suborderId]));
    expect(visible.rowCount).toBe(0);
    const ownVisible = await asUser(u.runtime, managerA.userId, c => c.query(`SELECT id FROM "VendorSuborder" WHERE id=$1`, [subA.suborderId]));
    expect(ownVisible.rowCount).toBe(1);
    await post(`/api/v1/vendor/suborders/${subB.suborderId}/reject`, managerB, { expectedVersion: 1, commandKey: `reject-${randomUUID().slice(0, 8)}`, reason: 'store b cannot fulfill today' }).expect(201);
    const historyB = await get(`/api/v1/vendor/suborders/${subB.suborderId}/history`, managerA).expect(404);
    expect(historyB.body.code).toBe('SUBORDER_NOT_FOUND');
  });

  it('blocks readiness until sandbox payment is verified, then allows the manual path', async () => {
    const order = await createOrder([{ variantId: variantA, quantity: 1 }], 'SANDBOX_MANUAL');
    const sub = order.suborders[0];
    const denied = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 20 }).expect(409);
    expect(denied.body.code).toBe('SUBORDER_PAYMENT_NOT_READY');
    const intent = await post(`/api/v1/orders/${order.orderId}/payment-intents`, customer, { commandKey: `intent-${randomUUID().slice(0, 8)}` }).expect(201);
    await webhook({ eventId: `evt-${randomUUID().slice(0, 8)}`, merchantReference: intent.body.merchantReference, status: 'SUCCEEDED', amountMinor: '1000', currency: 'BDT' }).expect(200);
    const accepted = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 20 }).expect(201);
    expect(accepted.body.status).toBe('ACCEPTED');
  });

  it('rejects with a reason, keeps rejection terminal and validates bounds/CSRF', async () => {
    const order = await createOrder([{ variantId: variantA, quantity: 1 }], 'COD');
    const sub = order.suborders[0];
    await post(`/api/v1/vendor/suborders/${sub.suborderId}/reject`, owner, { expectedVersion: 1, commandKey: `reject-${randomUUID().slice(0, 8)}`, reason: 'short' }).expect(400);
    await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 1, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 0 }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/vendor/suborders/${sub.suborderId}/reject`).set('Cookie', `gs_session_dev=${owner.token}`).send({ expectedVersion: 1, commandKey: `reject-${randomUUID().slice(0, 8)}`, reason: 'missing csrf token' }).expect(403);
    const rejected = await post(`/api/v1/vendor/suborders/${sub.suborderId}/reject`, owner, { expectedVersion: 1, commandKey: `reject-${randomUUID().slice(0, 8)}`, reason: 'out of stock for today' }).expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.rejectionReason).toBe('out of stock for today');
    const after = await post(`/api/v1/vendor/suborders/${sub.suborderId}/accept`, owner, { expectedVersion: 2, commandKey: `accept-${randomUUID().slice(0, 8)}`, preparationMinutes: 20 }).expect(409);
    expect(after.body.code).toBe('SUBORDER_INVALID_TRANSITION');
  });
});

describe('pre-dispatch cancellation across vendor/store suborders', () => {
  it('atomically cancels every suborder and restocks every consumed reservation exactly once', async () => {
    const order = await createOrder([{ variantId: variantA, quantity: 2 }, { variantId: variantB, quantity: 3 }], 'COD');
    const beforeA = (await get(`/api/v1/inventory/variants/${variantA}`, owner).expect(200)).body;
    const beforeB = (await get(`/api/v1/inventory/variants/${variantB}`, owner).expect(200)).body;
    const body = { expectedVersion: order.version, commandKey: `cancel-${randomUUID()}`, reason: 'cancel both vendor store groups before dispatch' };
    const cancelled = await post(`/api/v1/orders/${order.orderId}/cancellation`, customer, body).expect(201);
    expect(cancelled.body.restock).toBe('COMPLETED');
    expect(cancelled.body.refund).toBeNull();
    const after = (await get(`/api/v1/orders/${order.orderId}`, customer).expect(200)).body;
    expect(after.lifecycleStatus).toBe('CANCELLED');
    expect(after.suborders.map((s: any) => s.status)).toEqual(['CANCELLED', 'CANCELLED']);
    const a = (await get(`/api/v1/inventory/variants/${variantA}`, owner).expect(200)).body;
    const b = (await get(`/api/v1/inventory/variants/${variantB}`, owner).expect(200)).body;
    expect(a.onHand).toBe(beforeA.onHand + 2);
    expect(b.onHand).toBe(beforeB.onHand + 3);
    expect(a.reserved).toBe(beforeA.reserved);
    expect(b.reserved).toBe(beforeB.reserved);
    const replay = await post(`/api/v1/orders/${order.orderId}/cancellation`, customer, body).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const movements = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "InventoryMovement" WHERE "cancellationId"=$1 AND kind='RESTOCK'`, [cancelled.body.cancellationId]));
    expect(movements.rows[0].n).toBe(2);
    const subA = order.suborders.find((s: any) => s.storeId === storeA);
    const history = await get(`/api/v1/vendor/suborders/${subA.suborderId}/history`, managerA).expect(200);
    expect(history.body.items[0].toStatus).toBe('CANCELLED');
  });

  it('allows buyer cancellation after vendor rejection but closes the window once preparation starts', async () => {
    const rejectedOrder = await createOrder([{ variantId: variantA, quantity: 1 }], 'COD');
    const sub = rejectedOrder.suborders[0];
    await post(`/api/v1/vendor/suborders/${sub.suborderId}/reject`, managerA, { expectedVersion: 1, commandKey: `reject-${randomUUID()}`, reason: 'store cannot fulfill this order' }).expect(201);
    const current = (await get(`/api/v1/orders/${rejectedOrder.orderId}`, customer).expect(200)).body;
    const cancelled = await post(`/api/v1/orders/${rejectedOrder.orderId}/cancellation`, customer, { expectedVersion: current.version, commandKey: `cancel-${randomUUID()}`, reason: 'vendor rejected so buyer cancels order' }).expect(201);
    expect(cancelled.body.restock).toBe('COMPLETED');

    const activeOrder = await createOrder([{ variantId: variantA, quantity: 1 }], 'COD');
    const activeSub = activeOrder.suborders[0];
    await post(`/api/v1/vendor/suborders/${activeSub.suborderId}/accept`, managerA, { expectedVersion: 1, commandKey: `accept-${randomUUID()}`, preparationMinutes: 30 }).expect(201);
    await post(`/api/v1/vendor/suborders/${activeSub.suborderId}/start-preparation`, managerA, { expectedVersion: 2, commandKey: `prep-${randomUUID()}` }).expect(201);
    const denied = await post(`/api/v1/orders/${activeOrder.orderId}/cancellation`, customer, { expectedVersion: activeOrder.version, commandKey: `cancel-${randomUUID()}`, reason: 'too late to cancel preparation' }).expect(409);
    expect(denied.body.code).toBe('CANCELLATION_WINDOW_CLOSED');
  });
});
