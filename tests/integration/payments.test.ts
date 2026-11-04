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
const webhookSecret = 'payment-sandbox-webhook-secret-000000';
let countryId: string;
let cityId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-payments-test-${randomUUID()}`;
let customer: any;
let stranger: any;
let owner: any;
let vendorId: string;
let storeId: string;
let variantId: string;
let codAdmin: any;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `payments-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Payments ${label}`]);
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
async function grantKeys(user: { userId: string; sessionId: string; authVersion?: number }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `payments-role-${randomUUID()}`, 'Payments Role']);
    for (const key of keys) {
      const [resource] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=$1`,[user.userId]);
    await c.query(`UPDATE "Session" SET "authVersion"=(SELECT "authorizationVersion" FROM "User" WHERE id=$1) WHERE id=$2`,[user.userId,user.sessionId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`payments-evidence-${id}`).digest('hex');
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
async function createQuote(quantity = 1) {
  const cart = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
  const cartId = cart.body.cartId;
  let current = await get(`/api/v1/commerce/carts/${cartId}`, customer).expect(200);
  for (const item of current.body.items) {
    const removed = await request(app.getHttpServer()).delete(`/api/v1/commerce/carts/${cartId}/items/${item.variantId}?expectedVersion=${current.body.version}`).set('Cookie', `gs_session_dev=${customer.token}`).set('Origin', origin).set('X-CSRF-Token', customer.csrf).expect(200);
    current = removed;
  }
  const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId, quantity, expectedVersion: current.body.version }).expect(201);
  const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: added.body.version, destinationCityId: cityId, commandKey: `quote-${randomUUID().slice(0, 8)}` }).expect(201);
  return quote.body;
}
function webhook(body: unknown, secret = webhookSecret, timestamp = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer()).post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-gs-timestamp', timestamp).set('x-gs-signature', signSandboxWebhook(secret, timestamp, raw)).send(raw);
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  process.env['PAYMENTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYOUTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYMENT_SANDBOX_WEBHOOK_SECRET'] = webhookSecret; process.env['PAYMENTS_LIVE_ENABLED'] = 'false';
  process.env['RISK_SIGNAL_PRODUCERS_ENABLED'] = 'false';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `pay-reg-${randomUUID().slice(0, 8)}`, 'Payments', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `pay-dist-${randomUUID().slice(0, 8)}`, 'Payments', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `pay-city-${randomUUID().slice(0, 8)}`, 'Payments', 'CITY', 'ACTIVE']);
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
  const storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  const productModerator = await makeUser('product-moderator'); await grantKeys(productModerator, ['catalog:product:review', 'catalog:product:publish']);
  codAdmin = await makeUser('cod-admin'); await grantKeys(codAdmin, ['finance:cod:manage']);
  await asSuper(u.privileged, async c => { await c.query(`UPDATE "CodPolicy" SET enabled=false, version=version+1, "updatedAt"=now() WHERE "countryId"=$1`, [countryId]); });
  owner = await makeUser('owner');
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Payments Vendor' }).expect(201);
  vendorId = vendor.body.vendorId;
  const kyc = await post('/api/v1/kyc/cases', owner, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const kycCaseId = kyc.body.caseId;
  const docId = await makeStorageObject(owner.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, owner, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'Payments Store', slug: `payments-store-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  storeId = store.body.storeId;
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Payments Product', description: 'A product used for payment integration tests', brand: 'Stoopy' }).expect(201);
  const productId = product.body.productId;
  const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `PAY-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
  variantId = variant.body.id;
  await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/review`, productModerator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/publish`, productModerator, { version: 3, reason: 'approved for public catalog' }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 0 }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 100, commandKey: `stock-${variantId}`, reason: 'initial payment test stock' }).expect(201);
});
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('order/payment/COD sandbox foundation', () => {
  it('exposes disabled live capabilities and creates an immutable order that consumes quote reservations', async () => {
    const caps = await get('/api/v1/payments/capabilities', customer).expect(200);
    expect(caps.body.liveEnabled).toBe(false);
    expect(caps.body.sandboxEnabled).toBe(true);
    const ssl = caps.body.providers.find((p: any) => p.provider === 'SSLCOMMERZ');
    expect(ssl.capabilities.createCheckout).toBe(false);
    const quote = await createQuote(2);
    const commandKey = `order-${randomUUID().slice(0, 8)}`;
    const order = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
    expect(order.body.amountMinor).toBe('2000');
    expect(order.body.paymentStatus).toBe('AWAITING_PAYMENT');
    expect(order.body.suborders).toHaveLength(1);
    expect(order.body.suborders[0].items[0].quantity).toBe(2);
    const replay = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    await get(`/api/v1/orders/${order.body.orderId}`, stranger).expect(404);
    const quoteAfter = await get(`/api/v1/commerce/quotes/${quote.quoteId}`, customer).expect(200);
    expect(quoteAfter.body.state).toBe('CONSUMED');
    const inv = await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200);
    expect(inv.body.reserved).toBe(0);
    expect(inv.body.onHand).toBe(98);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "OrderItem" SET "productTitle"='tampered' WHERE "suborderId"=$1`, [order.body.suborders[0].suborderId]))).rejects.toThrow(/permission denied/);
  });

  it('verifies signed sandbox webhooks with exact amount/currency, idempotency and out-of-order protection', async () => {
    const quote = await createQuote(1);
    const order = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
    const intent = await post(`/api/v1/orders/${order.body.orderId}/payment-intents`, customer, { commandKey: `intent-${randomUUID().slice(0, 8)}` }).expect(201);
    expect(intent.body.checkout.mode).toBe('TEST_ONLY');
    expect(intent.body.checkout.redirectUrl).toBeNull();
    const base = { eventId: `evt-${randomUUID().slice(0, 8)}`, merchantReference: intent.body.merchantReference, providerReference: 'sandbox-txn-1', amountMinor: '1000', currency: 'BDT' };
    await webhook({ ...base, status: 'SUCCEEDED' }, 'wrong-secret').expect(401);
    const tampered = await webhook({ ...base, status: 'SUCCEEDED', amountMinor: '999' }).expect(200);
    expect(tampered.body.status).toBe('REJECTED');
    expect(tampered.body.reason).toBe('WEBHOOK_AMOUNT_MISMATCH');
    const wrongCurrency = await webhook({ ...base, eventId: `evt-${randomUUID().slice(0, 8)}`, status: 'SUCCEEDED', currency: 'USD' }).expect(200);
    expect(wrongCurrency.body.reason).toBe('WEBHOOK_CURRENCY_MISMATCH');
    const unknown = await webhook({ ...base, eventId: `evt-${randomUUID().slice(0, 8)}`, status: 'UNKNOWN' }).expect(200);
    expect(unknown.body.intentStatus).toBe('UNKNOWN');
    const successBody = { ...base, eventId: `evt-${randomUUID().slice(0, 8)}`, status: 'SUCCEEDED' };
    const applied = await webhook(successBody).expect(200);
    expect(applied.body.status).toBe('APPLIED');
    expect(applied.body.intentStatus).toBe('VERIFIED');
    const replay = await webhook(successBody).expect(200);
    expect(replay.body.duplicate).toBe(true);
    const lateFail = await webhook({ ...base, eventId: `evt-${randomUUID().slice(0, 8)}`, status: 'FAILED' }).expect(200);
    expect(lateFail.body.status).toBe('IGNORED_OUT_OF_ORDER');
    const orderAfter = await get(`/api/v1/orders/${order.body.orderId}`, customer).expect(200);
    expect(orderAfter.body.paymentStatus).toBe('PAYMENT_VERIFIED');
    const intentAfter = await get(`/api/v1/payment-intents/${intent.body.intentId}`, customer).expect(200);
    expect(intentAfter.body.status).toBe('VERIFIED');
    expect(intentAfter.body.verificationMethod).toBe('SANDBOX_HMAC_WEBHOOK');
    await expect(asUser(u.runtime, customer.userId, c => c.query(`UPDATE "PaymentIntent" SET status='FAILED' WHERE id=$1`, [intent.body.intentId]))).rejects.toThrow(/permission denied/);
  });

  it('fails closed for COD until a scoped step-up policy enables it, then enforces the maximum', async () => {
    const quote = await createQuote(1);
    const denied = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(409);
    expect(denied.body.code).toBe('COD_NOT_ELIGIBLE');
    await put('/api/v1/admin/cod-policy', stranger, { countryId, enabled: true, maxOrderMinor: '5000' }).expect(403);
    const existingPolicy = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "CodPolicy" WHERE "countryId"=$1`, [countryId])).rows[0]);
    const policy = await put('/api/v1/admin/cod-policy', codAdmin, { countryId, enabled: true, maxOrderMinor: '5000', ...(existingPolicy ? { version: existingPolicy.version } : {}) }).expect(200);
    expect(policy.body.version).toBe(existingPolicy ? existingPolicy.version + 1 : 1);
    const stale = await put('/api/v1/admin/cod-policy', codAdmin, { countryId, enabled: true, maxOrderMinor: '6000' }).expect(409);
    expect(stale.body.code).toBe('COD_POLICY_VERSION_CONFLICT');
    const quote2 = await createQuote(10);
    const tooMuch = await post('/api/v1/orders', customer, { quoteId: quote2.quoteId, expectedQuoteVersion: quote2.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(409);
    expect(tooMuch.body.code).toBe('COD_NOT_ELIGIBLE');
    const quote3 = await createQuote(2);
    const codOrder = await post('/api/v1/orders', customer, { quoteId: quote3.quoteId, expectedQuoteVersion: quote3.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(201);
    expect(codOrder.body.paymentStatus).toBe('AWAITING_COD');
    expect(codOrder.body.codEligibility.policyVersion).toBe(policy.body.version);
    await post(`/api/v1/orders/${codOrder.body.orderId}/payment-intents`, customer, { commandKey: `intent-${randomUUID().slice(0, 8)}` }).expect(409);
  });

  it('rejects unsigned/replayed webhook evidence and keeps webhook rows append-only', async () => {
    await request(app.getHttpServer()).post('/api/v1/payments/webhooks/sandbox').send({ eventId: 'evt-unsigned' }).expect(401);
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    await webhook({ eventId: `evt-${randomUUID().slice(0, 8)}`, merchantReference: 'PI-MISSING', status: 'SUCCEEDED', amountMinor: '1', currency: 'BDT' }, webhookSecret, staleTimestamp).expect(401);
    const events = await asSuper(u.privileged, async c => c.query(`SELECT id FROM "PaymentWebhookEvent" LIMIT 1`));
    expect(events.rows.length).toBeGreaterThan(0);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "PaymentWebhookEvent" SET "rejectionReason"='tampered' WHERE id=$1`, [events.rows[0].id]))).rejects.toThrow(/permission denied/);
  });
});

describe('cancellation, restock and refund review boundary', () => {
  async function paidOrder(quantity = 2) {
    const quote = await createQuote(quantity);
    const order = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
    const intent = await post(`/api/v1/orders/${order.body.orderId}/payment-intents`, customer, { commandKey: `intent-${randomUUID().slice(0, 8)}` }).expect(201);
    await webhook({ eventId: `evt-${randomUUID()}`, merchantReference: intent.body.merchantReference, status: 'SUCCEEDED', amountMinor: order.body.amountMinor, currency: 'BDT' }).expect(200);
    return (await get(`/api/v1/orders/${order.body.orderId}`, customer).expect(200)).body;
  }
  function cancelBody(version: number, key = `cancel-${randomUUID()}`) { return { expectedVersion: version, commandKey: key, reason: 'buyer requested pre-dispatch cancellation' }; }

  it('blocks cancellation while online payment is unresolved and hides foreign orders', async () => {
    const quote = await createQuote(1);
    const order = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
    const denied = await post(`/api/v1/orders/${order.body.orderId}/cancellation`, customer, cancelBody(1)).expect(409);
    expect(denied.body.code).toBe('PAYMENT_RESOLUTION_REQUIRED');
    await post(`/api/v1/orders/${order.body.orderId}/cancellation`, stranger, cancelBody(1)).expect(404);
    const still = await get(`/api/v1/orders/${order.body.orderId}`, customer).expect(200);
    expect(still.body.lifecycleStatus).toBe('ACTIVE');
  });

  it('atomically cancels a verified order, restocks once and creates a pending refund without moving money', async () => {
    const order = await paidOrder(2);
    const before = (await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200)).body;
    const body = cancelBody(order.version);
    const results = await Promise.all([post(`/api/v1/orders/${order.orderId}/cancellation`, customer, body), post(`/api/v1/orders/${order.orderId}/cancellation`, customer, body)]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect(results.map(r => r.body.duplicate).sort()).toEqual([false, true]);
    const cancelled = results[0].body;
    expect(cancelled.restock).toBe('COMPLETED');
    expect(cancelled.refund.status).toBe('PENDING_REVIEW');
    expect(cancelled.refund.amountMinor).toBe(order.amountMinor);
    expect(cancelled.refund.execution).toBe('DISABLED');
    expect(cancelled.refund.moneyMoved).toBe(false);
    const after = (await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200)).body;
    expect(after.onHand).toBe(before.onHand + 2); // consumed by paidOrder, then returned exactly once
    expect(after.reserved).toBe(before.reserved);
    const detail = (await get(`/api/v1/orders/${order.orderId}`, customer).expect(200)).body;
    expect(detail.lifecycleStatus).toBe('CANCELLED');
    expect(detail.suborders[0].status).toBe('CANCELLED');
    expect(detail.paymentStatus).toBe('PAYMENT_VERIFIED');
    const conflict = await post(`/api/v1/orders/${order.orderId}/cancellation`, customer, { ...body, reason: 'different reason payload' }).expect(409);
    expect(conflict.body.code).toBe('CANCELLATION_IDEMPOTENCY_CONFLICT');
    const movements = await asSuper(u.privileged, c => c.query(`SELECT m.kind, m."onHandDelta", m."reservedDelta", r.state FROM "InventoryMovement" m JOIN "InventoryReservation" r ON r.id=m."reservationId" WHERE m."cancellationId"=$1`, [cancelled.cancellationId]));
    expect(movements.rows).toEqual([{ kind: 'RESTOCK', onHandDelta: 2, reservedDelta: 0, state: 'CONSUMED' }]);
    await get(`/api/v1/refunds/${cancelled.refund.refundRequestId}`, stranger).expect(404);
    await expect(asUser(u.runtime, customer.userId, c => c.query(`SELECT id FROM "RefundRequest" WHERE id=$1`, [cancelled.refund.refundRequestId]))).resolves.toMatchObject({ rowCount: 1 });
  });

  it('requires scoped step-up finance review, separate reviewer, idempotency and terminal decision; approval never executes refund', async () => {
    const order = await paidOrder(1);
    const cancelled = (await post(`/api/v1/orders/${order.orderId}/cancellation`, customer, cancelBody(order.version)).expect(201)).body;
    const id = cancelled.refund.refundRequestId;
    const reviewer = await makeUser('refund-reviewer'); await grantKeys(reviewer, ['finance:refund:review']);
    await get(`/api/v1/admin/refunds?countryId=${countryId}`, stranger).expect(403);
    const list = await get(`/api/v1/admin/refunds?countryId=${countryId}`, reviewer).expect(200);
    expect(list.body.items.some((r: any) => r.refundRequestId === id)).toBe(true);
    await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='MFA', "stepUpExpiresAt"=NULL WHERE id=$1`, [reviewer.sessionId]); });
    const body = { expectedVersion: 1, decision: 'APPROVE', commandKey: `review-${randomUUID()}`, reason: 'verified cancellation and payment evidence' };
    await post(`/api/v1/admin/refunds/${id}/review`, reviewer, body).expect(403);
    await setStepUp(reviewer);
    const approved = await post(`/api/v1/admin/refunds/${id}/review`, reviewer, body).expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.execution).toBe('SANDBOX_RESERVED');
    expect(approved.body.moneyMoved).toBe(false);
    const replay = await post(`/api/v1/admin/refunds/${id}/review`, reviewer, body).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const changed = await post(`/api/v1/admin/refunds/${id}/review`, reviewer, { ...body, decision: 'REJECT' }).expect(409);
    expect(changed.body.code).toBe('REFUND_IDEMPOTENCY_CONFLICT');
    const again = await post(`/api/v1/admin/refunds/${id}/review`, reviewer, { ...body, commandKey: `review-${randomUUID()}` }).expect(409);
    expect(again.body.code).toBe('REFUND_ALREADY_REVIEWED');
    const execution = await asSuper(u.privileged, c => c.query(`SELECT id, status, "reservationJournalId" FROM "RefundExecution" WHERE "refundRequestId"=$1`, [id]));
    expect(execution.rows[0].status).toBe('RESERVED');
    const journals = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "LedgerJournal" WHERE id=$1`, [execution.rows[0].reservationJournalId]));
    expect(journals.rows[0].n).toBe(1);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "RefundReview" SET reason='tampered' WHERE "refundRequestId"=$1`, [id]))).rejects.toThrow(/permission denied|append_only/);
  });

  it('executes an approved refund only in sandbox, retries unknown submission and reconciles exactly once', async () => {
    process.env['PAYOUTS_SANDBOX_ENABLED']='true';
    const order=await paidOrder(1); const cancelled=(await post(`/api/v1/orders/${order.orderId}/cancellation`,customer,cancelBody(order.version)).expect(201)).body; const refundId=cancelled.refund.refundRequestId;
    const reviewer=await makeUser('sandbox-refund-reviewer');await grantKeys(reviewer,['finance:refund:review']);
    await post(`/api/v1/admin/refunds/${refundId}/review`,reviewer,{expectedVersion:1,decision:'APPROVE',commandKey:`approve-${randomUUID()}`,reason:'verified sandbox payment cancellation'}).expect(201);
    const execution=await asSuper(u.privileged,c=>c.query(`SELECT id FROM "RefundExecution" WHERE "refundRequestId"=$1`,[refundId]));const id=execution.rows[0].id;
    const executor=await makeUser('sandbox-refund-executor');await grantKeys(executor,['finance:refund:execute','finance:reconciliation:import']);
    await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/submit`,stranger,{commandKey:`submit-${randomUUID()}`}).expect(403);
    const unknown=await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/submit`,executor,{commandKey:`unknown-${randomUUID()}`,simulateUnknown:true}).expect(201);expect(unknown.body.status).toBe('RESERVED');
    const body={commandKey:`submit-${randomUUID()}`};const submitted=await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/submit`,executor,body).expect(201);expect(submitted.body.status).toBe('SUBMITTED');expect(submitted.body.moneyMoved).toBe(false);
    expect((await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/submit`,executor,body).expect(201)).body.duplicate).toBe(true);
    const statement={status:'SUCCEEDED',statementReference:`stmt-${randomUUID()}`,evidenceHash:createHash('sha256').update(randomUUID()).digest('hex'),commandKey:`reconcile-${randomUUID()}`};
    const done=await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/reconcile`,executor,statement).expect(201);expect(done.body.transfer.status).toBe('SUCCEEDED');expect(done.body.transfer.mode).toBe('TEST_ONLY');
    expect((await post(`/api/v1/admin/sandbox-transfers/refunds/${id}/reconcile`,executor,statement).expect(201)).body.duplicate).toBe(true);
    const detail=await get(`/api/v1/sandbox-transfers/refunds/${id}`,customer).expect(200);expect(detail.body.attempts.map((a:any)=>a.outcome)).toEqual(['UNKNOWN','SUBMITTED']);
    await get(`/api/v1/sandbox-transfers/refunds/${id}`,stranger).expect(404);
    const balanced=await asSuper(u.privileged,c=>c.query(`SELECT SUM(CASE WHEN side='DEBIT' THEN "amountMinor" ELSE -"amountMinor" END)::bigint AS net FROM "LedgerLine" WHERE "journalId"=$1`,[done.body.journalId]));expect(balanced.rows[0].net).toBe('0');
    await expect(asSuper(u.privileged,c=>c.query(`UPDATE "ProviderStatementEntry" SET status='FAILED' WHERE id=$1`,[done.body.statementId]))).rejects.toThrow(/permission denied|append_only/);
  });

  it('rejects a refund with an audited terminal decision and no financial execution', async () => {
    const order = await paidOrder(1);
    const cancelled = (await post(`/api/v1/orders/${order.orderId}/cancellation`, customer, cancelBody(order.version)).expect(201)).body;
    const reviewer = await makeUser('refund-rejector'); await grantKeys(reviewer, ['finance:refund:review']);
    const rejected = await post(`/api/v1/admin/refunds/${cancelled.refund.refundRequestId}/review`, reviewer, { expectedVersion: 1, decision: 'REJECT', commandKey: `reject-${randomUUID()}`, reason: 'evidence requires manual investigation' }).expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.moneyMoved).toBe(false);
  });

  it('cancels COD without a refund request and enforces database restock/cancellation invariants', async () => {
    const existing = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "CodPolicy" WHERE "countryId"=$1`, [countryId])).rows[0]);
    await put('/api/v1/admin/cod-policy', codAdmin, { countryId, enabled: true, maxOrderMinor: '100000', ...(existing ? { version: existing.version } : {}) }).expect(200);
    const quote = await createQuote(1);
    const order = await post('/api/v1/orders', customer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(201);
    const cancelled = (await post(`/api/v1/orders/${order.body.orderId}/cancellation`, customer, cancelBody(1)).expect(201)).body;
    expect(cancelled.refund).toBeNull();
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "OrderCancellation" SET reason='tampered' WHERE id=$1`, [cancelled.cancellationId]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "InventoryMovement" SET "onHandDelta"=99 WHERE "cancellationId"=$1`, [cancelled.cancellationId]))).rejects.toThrow(/permission denied|append_only/);
    // Direct lifecycle mutation without the complete cancellation/restock aggregate must fail at COMMIT.
    const q2 = await createQuote(1);
    const o2 = await post('/api/v1/orders', customer, { quoteId: q2.quoteId, expectedQuoteVersion: q2.version, commandKey: `order-${randomUUID().slice(0, 8)}`, paymentMethod: 'COD' }).expect(201);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Order" SET "lifecycleStatus"='CANCELLED', version=version+1 WHERE id=$1`, [o2.body.orderId]))).rejects.toThrow(/order_cancellation_record_required/);
  });
});
