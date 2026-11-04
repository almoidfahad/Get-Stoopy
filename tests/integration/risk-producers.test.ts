import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, approveStoreCoverage } from './helpers';
import { signSandboxWebhook } from '../../packages/core/src/payment';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
const webhookSecret = 'risk-producer-webhook-secret-000000';
let countryId: string, cityId: string, variantId: string;
let owner: any, reviewer: any;
let pool: pg.Pool, queue: Queue, redis: Redis;
const queueName = `gs-risk-producers-test-${randomUUID()}`;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `risk-prod-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Risk producer ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
const post = (path: string, user: any, body: unknown = {}) => request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body as object);
const get = (path: string, user: any) => request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`);
const put = (path: string, user: any, body: unknown = {}) => request(app.getHttpServer()).put(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body as object);
async function grantKeys(user: any, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `risk-prod-role-${randomUUID()}`, 'Risk producer test']);
    for (const key of keys) {
      const [resource] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,'critical') ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1)]);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    await c.query(`UPDATE "User" SET "authorizationVersion"="authorizationVersion"+1 WHERE id=$1`, [user.userId]);
    await c.query(`UPDATE "Session" SET "authVersion"=(SELECT "authorizationVersion" FROM "User" WHERE id=$1),"assuranceLevel"='STEP_UP',"stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$2`, [user.userId, user.sessionId]);
    await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,'COUNTRY',$3,$4)`, [randomUUID(), user.userId, countryId, user.userId]);
  });
}
async function storageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`risk-prod-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,'kyc-document',$3,'application/pdf',100,$4,'UPLOADED',true,'local-dev-aes-256-gcm',now())`, [id, ownerId, `kyc-document/${ownerId}/${id}`, hash]);
  });
  return id;
}
async function approveVendorKyc(subject: any, approver: any) {
  const kyc = await post('/api/v1/kyc/cases', subject, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const docId = await storageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${kyc.body.caseId}/documents`, subject, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kyc.body.caseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kyc.body.caseId}/decision`, approver, { version: 2, commandKey: `start-${randomUUID()}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kyc.body.caseId}/decision`, approver, { version: 3, commandKey: `approve-${randomUUID()}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }).expect(201);
  return kyc.body.caseId as string;
}
async function createQuote(buyer: any, quantity = 1) {
  const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
  let current = await get(`/api/v1/commerce/carts/${cart.body.cartId}`, buyer).expect(200);
  for (const item of current.body.items) {
    current = await request(app.getHttpServer()).delete(`/api/v1/commerce/carts/${cart.body.cartId}/items/${item.variantId}?expectedVersion=${current.body.version}`).set('Cookie', `gs_session_dev=${buyer.token}`).set('Origin', origin).set('X-CSRF-Token', buyer.csrf).expect(200);
  }
  const added = await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId, quantity, expectedVersion: current.body.version }).expect(201);
  const quote = await post(`/api/v1/commerce/carts/${cart.body.cartId}/quotes`, buyer, { expectedVersion: added.body.version, destinationCityId: cityId, commandKey: `quote-${randomUUID()}` }).expect(201);
  return quote.body;
}
async function createOrder(buyer: any) {
  const quote = await createQuote(buyer);
  const order = await post('/api/v1/orders', buyer, { quoteId: quote.quoteId, expectedQuoteVersion: quote.version, commandKey: `order-${randomUUID()}`, paymentMethod: 'SANDBOX_MANUAL' }).expect(201);
  return order.body;
}
function webhook(body: unknown) {
  const raw = JSON.stringify(body); const timestamp = String(Math.floor(Date.now() / 1000));
  return request(app.getHttpServer()).post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('x-gs-timestamp', timestamp).set('x-gs-signature', signSandboxWebhook(webhookSecret, timestamp, raw)).send(raw);
}
async function producerCases(subjectId: string, kind: string) {
  return asSuper(u.privileged, async c => (await c.query(`SELECT c.*, s.code, s.summary FROM "RiskCase" c JOIN "RiskSignal" s ON s."caseId"=c.id WHERE c."subjectUserId"=$1 AND c.kind=$2 AND c."producerKey" IS NOT NULL`, [subjectId, kind])).rows);
}
async function drainOutbox() {
  for (let i = 0; i < 25; i++) {
    const pending = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(), "leaseToken"=NULL, "leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`);
    if ((pending.rowCount ?? 0) === 0) return;
    await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName });
  }
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin;
  process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15';
  process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  process.env['PAYMENTS_SANDBOX_ENABLED'] = 'true'; process.env['PAYMENT_SANDBOX_WEBHOOK_SECRET'] = webhookSecret; process.env['PAYMENTS_LIVE_ENABLED'] = 'false';
  process.env['RISK_SIGNAL_PRODUCERS_ENABLED'] = 'true';
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,'BD','Bangladesh','BDT','+880','Asia/Dhaka','ACTIVE') ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID()])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), countryId, `risk-reg-${randomUUID()}`, 'Risk producers']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), region.rows[0].id, `risk-dist-${randomUUID()}`, 'Risk producers']);
    return (await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,'CITY','ACTIVE') RETURNING id`, [randomUUID(), district.rows[0].id, `risk-city-${randomUUID()}`, 'Risk producers'])).rows[0].id as string;
  });
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis }); await drainOutbox();
  owner = await makeUser('owner');
  const kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  const storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  const moderator = await makeUser('moderator'); await grantKeys(moderator, ['catalog:product:review', 'catalog:product:publish']);
  reviewer = await makeUser('risk-reviewer'); await grantKeys(reviewer, ['risk:case:review']);
  await grantKeys(owner, []);
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Risk Producer Vendor' }).expect(201);
  const kycCaseId = await approveVendorKyc(owner, kycReviewer);
  await post(`/api/v1/parties/admin/vendors/${vendor.body.vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId: vendor.body.vendorId, cityId, name: 'Risk Producer Store', slug: `risk-prod-store-${randomUUID()}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  await post(`/api/v1/catalog/admin/stores/${store.body.storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  await approveStoreCoverage({ privilegedUrl: u.privileged, cityId, storeId: store.body.storeId, owner, makeUser, grantKeys, post }, 'risk');
  const product = await post(`/api/v1/catalog/stores/${store.body.storeId}/products`, owner, { title: 'Risk Producer Product', description: 'A product used for risk producer integration tests', brand: 'Stoopy' }).expect(201);
  const variant = await post(`/api/v1/catalog/products/${product.body.productId}/variants`, owner, { sku: `RISK-${randomUUID()}`, optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
  variantId = variant.body.id;
  await post(`/api/v1/catalog/products/${product.body.productId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/catalog/admin/products/${product.body.productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
  await post(`/api/v1/catalog/admin/products/${product.body.productId}/publish`, moderator, { version: 3, reason: 'approved for public catalog' }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 0 }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 1000, commandKey: `stock-${variantId}`, reason: 'initial risk producer test stock' }).expect(201);
});
afterAll(async () => {
  process.env['RISK_SIGNAL_PRODUCERS_ENABLED'] = 'false';
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('deterministic risk signal producers', () => {
  it('records checkout velocity only at the threshold and never blocks or suspends', async () => {
    const buyer = await makeUser('velocity-buyer');
    for (let i = 0; i < 5; i++) {
      const order = await createOrder(buyer);
      expect(order.lifecycleStatus).toBe('ACTIVE');
      expect((await producerCases(buyer.userId, 'ORDER_ABUSE')).length).toBe(0);
    }
    const sixth = await createOrder(buyer);
    expect(sixth.lifecycleStatus).toBe('ACTIVE');
    expect(sixth.paymentStatus).toBe('AWAITING_PAYMENT');
    const cases = await producerCases(buyer.userId, 'ORDER_ABUSE');
    expect(cases).toHaveLength(1);
    expect(cases[0].code).toBe('VELOCITY_ORDERS_HIGH');
    expect(cases[0].score).toBe(25);
    expect(cases[0].band).toBe('LOW');
    expect(cases[0].status).toBe('OPEN');
    expect(cases[0].openedByUserId).toBeNull();
    expect(cases[0].summary.observedCount).toBe(6);
    expect(cases[0].summary.automatedEnforcement).toBe(false);
    const user = await asSuper(u.privileged, async c => (await c.query(`SELECT status FROM "User" WHERE id=$1`, [buyer.userId])).rows[0]);
    expect(user.status).not.toBe('SUSPENDED');
    const outbox = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "OutboxEvent" WHERE "aggregateType"='RiskCase' AND "aggregateId"=$1`, [cases[0].id])).rows);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].eventType).toBe('risk.signal.recorded');
    const audit = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "AuditLog" WHERE "resourceType"='RiskCase' AND "resourceId"=$1 AND action='risk.case.opened'`, [cases[0].id])).rows);
    expect(audit).toHaveLength(1);
    expect(audit[0].actorType).toBe('SYSTEM');
    // Further same-day orders do not inflate the same signal or open a duplicate case.
    await createOrder(buyer);
    const after = await producerCases(buyer.userId, 'ORDER_ABUSE');
    expect(after).toHaveLength(1);
    expect(after[0].version).toBe(cases[0].version);
    expect(after[0].id).toBe(cases[0].id);
  });

  it('records verified sandbox payment-failure bursts across distinct orders, idempotently', async () => {
    const buyer = await makeUser('payment-burst-buyer');
    const intents: any[] = [];
    for (let i = 0; i < 3; i++) {
      const order = await createOrder(buyer);
      const intent = await post(`/api/v1/orders/${order.orderId}/payment-intents`, buyer, { commandKey: `intent-${randomUUID()}` }).expect(201);
      intents.push({ order, intent: intent.body });
    }
    // A rejected amount mismatch is not a verified failure and must not count.
    await webhook({ eventId: `evt-${randomUUID()}`, merchantReference: intents[0].intent.merchantReference, status: 'FAILED', amountMinor: '999', currency: 'BDT' }).expect(200);
    expect((await producerCases(buyer.userId, 'PAYMENT_ABUSE')).length).toBe(0);
    for (let i = 0; i < 2; i++) {
      const failed = await webhook({ eventId: `evt-${randomUUID()}`, merchantReference: intents[i].intent.merchantReference, status: 'FAILED', amountMinor: '1000', currency: 'BDT' }).expect(200);
      expect(failed.body.intentStatus).toBe('FAILED');
    }
    expect((await producerCases(buyer.userId, 'PAYMENT_ABUSE')).length).toBe(0);
    const thirdBody = { eventId: `evt-${randomUUID()}`, merchantReference: intents[2].intent.merchantReference, status: 'FAILED', amountMinor: '1000', currency: 'BDT' };
    await webhook(thirdBody).expect(200);
    const cases = await producerCases(buyer.userId, 'PAYMENT_ABUSE');
    expect(cases).toHaveLength(1);
    expect(cases[0].code).toBe('PAYMENT_FAILED_BURST');
    expect(cases[0].summary.observedCount).toBe(3);
    expect(cases[0].summary.threshold).toBe(3);
    expect(cases[0].summary.automatedEnforcement).toBe(false);
    const replay = await webhook(thirdBody).expect(200);
    expect(replay.body.duplicate).toBe(true);
    const after = await producerCases(buyer.userId, 'PAYMENT_ABUSE');
    expect(after).toHaveLength(1);
    expect(after[0].version).toBe(cases[0].version);
    const orderAfter = await get(`/api/v1/orders/${intents[2].order.orderId}`, buyer).expect(200);
    expect(orderAfter.body.paymentStatus).toBe('PAYMENT_FAILED');
    expect(orderAfter.body.lifecycleStatus).toBe('ACTIVE');
  });

  it('does not reopen a terminal producer case on later same-day evidence', async () => {
    const buyer = await makeUser('terminal-buyer');
    for (let i = 0; i < 6; i++) await createOrder(buyer);
    const cases = await producerCases(buyer.userId, 'ORDER_ABUSE');
    expect(cases).toHaveLength(1);
    const review = await post(`/api/v1/risk/cases/${cases[0].id}/review`, reviewer, { expectedVersion: cases[0].version, decision: 'CLEAR', reason: 'Reviewed checkout velocity and found legitimate bulk ordering', commandKey: `clear-${randomUUID()}` }).expect(201);
    expect(review.body.status).toBe('CLEARED');
    await createOrder(buyer);
    const after = await producerCases(buyer.userId, 'ORDER_ABUSE');
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe('CLEARED');
    expect(after[0].version).toBe(review.body.version);
    const outbox = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "OutboxEvent" WHERE "aggregateType"='RiskCase' AND "aggregateId"=$1 AND "eventType"='risk.signal.recorded'`, [cases[0].id])).rows);
    expect(outbox).toHaveLength(1);
  });
});
