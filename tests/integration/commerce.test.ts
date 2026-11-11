import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, asUser } from './helpers';
import { isProductPage, isPublicProduct } from '../../apps/web/src/lib/catalog-validation';
import { runInventoryExpiryTick } from '../../apps/worker/src/inventory-expiry';

const u = urls();
let app: any;
const origin = 'http://localhost:3000';
let countryId: string;
let cityId: string;
let zoneId: string;
let serviceabilityAdmin: any;
let pool: pg.Pool;
let privilegedPool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-commerce-test-${randomUUID()}`;
let customer: any;
let stranger: any;
let vendorA: any;
let vendorB: any;
let storeA: string;
let storeB: string;
let variantA: string;
let variantB: string;
let productA: string;
let kycReviewer: any;
let partyAdmin: any;
let storeAdmin: any;
let productModerator: any;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `commerce-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Commerce ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function patch(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).patch(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function del(path: string, user: { token: string; csrf: string }) {
  return request(app.getHttpServer()).delete(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf);
}
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
async function setStepUp(user: { sessionId: string }) {
  await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]); });
}
async function grantKeys(user: { userId: string; sessionId: string }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `commerce-role-${randomUUID()}`, 'Commerce Role']);
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
  const id = randomUUID(); const hash = createHash('sha256').update(`commerce-evidence-${id}`).digest('hex');
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
async function setupVendor(label: string, price: string, stock: number) {
  const owner = await makeUser(`owner-${label}`);
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: `Commerce Vendor ${label}` }).expect(201);
  const vendorId = vendor.body.vendorId;
  const kyc = await post('/api/v1/kyc/cases', owner, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const kycCaseId = kyc.body.caseId;
  const docId = await makeStorageObject(owner.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, owner, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: `Commerce Store ${label}`, slug: `commerce-store-${label}-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  const storeId = store.body.storeId;
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  // Checkout now requires the destination to be served, so a fixture store is only
  // complete once it has an approved service area in an active zone.
  const area = await post(`/api/v1/catalog/stores/${storeId}/service-areas`, owner, { serviceZoneId: zoneId }).expect(201);
  await post(`/api/v1/catalog/admin/service-areas/${area.body.serviceAreaId}/review`, serviceabilityAdmin, { version: 1, decision: 'APPROVE', reason: 'service area geometry verified' }).expect(201);
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: `Commerce Product ${label}`, description: 'A product used for commerce integration tests', brand: 'Stoopy' }).expect(201);
  const productId = product.body.productId;
  const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `COM-${label}-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: price, currency: 'BDT' }).expect(201);
  const variantId = variant.body.id;
  await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/review`, productModerator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
  await post(`/api/v1/catalog/admin/products/${productId}/publish`, productModerator, { version: 3, reason: 'approved for public catalog' }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 0 }).expect(201);
  await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: stock, commandKey: `stock-${variantId}`, reason: 'initial commerce stock' }).expect(201);
  return { owner, vendorId, storeId, productId, variantId };
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `com-reg-${randomUUID().slice(0, 8)}`, 'Commerce', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `com-dist-${randomUUID().slice(0, 8)}`, 'Commerce', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `com-city-${randomUUID().slice(0, 8)}`, 'Commerce', 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
  zoneId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "ServiceZone"(id,"cityId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), cityId, `com-zone-${randomUUID().slice(0, 8)}`, 'Commerce Zone'])).rows[0].id as string);
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  privilegedPool = new pg.Pool({ connectionString: u.privileged, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();
  customer = await makeUser('customer');
  stranger = await makeUser('stranger');
  kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  productModerator = await makeUser('product-moderator'); await grantKeys(productModerator, ['catalog:product:review', 'catalog:product:publish']);
  serviceabilityAdmin = await makeUser('serviceability-admin'); await grantKeys(serviceabilityAdmin, ['catalog:store:serviceability:review']);
  vendorA = await setupVendor('a', '1000', 10);
  vendorB = await setupVendor('b', '250', 10);
  storeA = vendorA.storeId; storeB = vendorB.storeId; variantA = vendorA.variantId; variantB = vendorB.variantId; productA = vendorA.productId;
});
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (privilegedPool) await privilegedPool.end();
  if (app) await app.close();
});

describe('cart and checkout quote orchestration', () => {
  it('returns stocked product data accepted by the storefront contract', async () => {
    const detail = await request(app.getHttpServer()).get(`/api/v1/public/catalog/products/${productA}?countryId=${countryId}`).expect(200);
    expect(isPublicProduct(detail.body)).toBe(true);
    expect(detail.body.variants.find((v: any) => v.id === variantA)).toMatchObject({ priceAmountMinor: '1000', availableToPromise: 10, inStock: true });
    const page = await request(app.getHttpServer()).get(`/api/v1/public/catalog/products?countryId=${countryId}`).expect(200);
    expect(isProductPage(page.body)).toBe(true);
    expect(page.body.items.some((p: any) => p.id === productA)).toBe(true);
  });
  it('creates owner-scoped carts and enforces versioned item mutations and sellability', async () => {
    const created = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
    expect(created.body.duplicate).toBe(false);
    const cartId = created.body.cartId;
    const duplicate = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
    expect(duplicate.body.cartId).toBe(cartId);
    expect(duplicate.body.duplicate).toBe(true);
    await get(`/api/v1/commerce/carts/${cartId}`, stranger).expect(404);
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantA, quantity: 2, expectedVersion: 1 }).expect(201);
    expect(added.body.version).toBe(2);
    expect(added.body.items[0].lineTotalMinor).toBe('2000');
    const stale = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantB, quantity: 1, expectedVersion: 1 }).expect(409);
    expect(stale.body.code).toBe('CART_VERSION_CONFLICT');
    const updated = await patch(`/api/v1/commerce/carts/${cartId}/items/${variantA}`, customer, { quantity: 3, expectedVersion: 2 }).expect(200);
    expect(updated.body.version).toBe(3);
    expect(updated.body.items[0].quantity).toBe(3);
    const removed = await del(`/api/v1/commerce/carts/${cartId}/items/${variantA}?expectedVersion=3`, customer).expect(200);
    expect(removed.body.version).toBe(4);
    expect(removed.body.items).toHaveLength(0);
    await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantA, quantity: 0, expectedVersion: 4 }).expect(400);
    await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantA, quantity: 101, expectedVersion: 4 }).expect(400);
    const draftProduct = await post(`/api/v1/catalog/stores/${storeA}/products`, vendorA.owner, { title: 'Draft Commerce Product', description: 'Not published yet', brand: 'Stoopy' }).expect(201);
    const draftVariant = await post(`/api/v1/catalog/products/${draftProduct.body.productId}/variants`, vendorA.owner, { sku: `DRAFT-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '100', currency: 'BDT' }).expect(201);
    const notSellable = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: draftVariant.body.id, quantity: 1, expectedVersion: 4 }).expect(409);
    expect(notSellable.body.code).toBe('CART_VARIANT_NOT_SELLABLE');
  });

  it('creates an atomic multi-vendor quote with immutable snapshots, idempotency and release', async () => {
    const cart = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
    const cartId = cart.body.cartId;
    let v = cart.body.version;
    const a = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantA, quantity: 2, expectedVersion: v }).expect(201); v = a.body.version;
    const b = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantB, quantity: 3, expectedVersion: v }).expect(201); v = b.body.version;
    const commandKey = `quote-${randomUUID().slice(0, 8)}`;
    const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: v, destinationCityId: cityId, commandKey }).expect(201);
    expect(quote.body.state).toBe('RESERVED');
    expect(quote.body.subtotalMinor).toBe('2750');
    expect(quote.body.groups).toHaveLength(2);
    expect(quote.body.items).toHaveLength(2);
    const unfinishedTotals = { deliveryFeeMinor: null, totalMinor: null, paymentStatus: 'NOT_IMPLEMENTED' };
    expect(quote.body).toMatchObject(unfinishedTotals);
    const groupA = quote.body.groups.find((g: any) => g.storeId === storeA);
    const groupB = quote.body.groups.find((g: any) => g.storeId === storeB);
    expect(groupA.subtotalMinor).toBe('2000');
    expect(groupB.subtotalMinor).toBe('750');
    const replay = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: v, destinationCityId: cityId, commandKey }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.quoteId).toBe(quote.body.quoteId);
    expect(replay.body).toMatchObject(unfinishedTotals);
    const read = await get(`/api/v1/commerce/quotes/${quote.body.quoteId}`, customer).expect(200);
    expect(read.body).toMatchObject(unfinishedTotals);
    const conflict = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, { expectedVersion: v + 1, destinationCityId: cityId, commandKey }).expect(409);
    expect(conflict.body.code).toBe('CHECKOUT_IDEMPOTENCY_CONFLICT');
    await get(`/api/v1/commerce/quotes/${quote.body.quoteId}`, stranger).expect(404);
    const invA = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    expect(invA.body.reserved).toBe(2);
    const invB = await get(`/api/v1/inventory/variants/${variantB}`, vendorB.owner).expect(200);
    expect(invB.body.reserved).toBe(3);
    const released = await post(`/api/v1/commerce/quotes/${quote.body.quoteId}/release`, customer, { version: 1, reason: 'customer cancelled checkout' }).expect(201);
    expect(released.body.state).toBe('RELEASED');
    expect(released.body).toMatchObject(unfinishedTotals);
    const releasedAgain = await post(`/api/v1/commerce/quotes/${quote.body.quoteId}/release`, customer, { version: 1, reason: 'customer cancelled checkout' }).expect(201);
    expect(releasedAgain.body.duplicate).toBe(true);
    expect(releasedAgain.body).toMatchObject(unfinishedTotals);
    const invAAfter = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    expect(invAAfter.body.reserved).toBe(0);
    const invBAfter = await get(`/api/v1/inventory/variants/${variantB}`, vendorB.owner).expect(200);
    expect(invBAfter.body.reserved).toBe(0);
  });

  it('rolls back every reservation when one cart line has insufficient stock', async () => {
    const rollbackCustomer = await makeUser('rollback');
    const cart = await post('/api/v1/commerce/carts', rollbackCustomer, { countryId }).expect(201);
    const cartId = cart.body.cartId;
    let v = cart.body.version;
    const a = await post(`/api/v1/commerce/carts/${cartId}/items`, rollbackCustomer, { variantId: variantA, quantity: 1, expectedVersion: v }).expect(201); v = a.body.version;
    const b = await post(`/api/v1/commerce/carts/${cartId}/items`, rollbackCustomer, { variantId: variantB, quantity: 100, expectedVersion: v }).expect(201); v = b.body.version;
    const beforeA = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    const beforeB = await get(`/api/v1/inventory/variants/${variantB}`, vendorB.owner).expect(200);
    const failed = await post(`/api/v1/commerce/carts/${cartId}/quotes`, rollbackCustomer, { expectedVersion: v, destinationCityId: cityId, commandKey: `quote-${randomUUID().slice(0, 8)}` }).expect(409);
    expect(failed.body.code).toBe('INSUFFICIENT_STOCK');
    const afterA = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    const afterB = await get(`/api/v1/inventory/variants/${variantB}`, vendorB.owner).expect(200);
    expect(afterA.body.reserved).toBe(beforeA.body.reserved);
    expect(afterB.body.reserved).toBe(beforeB.body.reserved);
    const quotes = await asSuper(u.privileged, async c => c.query(`SELECT count(*)::int AS n FROM "CheckoutQuote" WHERE "cartId"=$1`, [cartId]));
    expect(quotes.rows[0].n).toBe(0);
  });

  it('rejects an unrepresentable subtotal atomically and can quote a smaller cart', async () => {
    const buyer = await makeUser('subtotal-limit');
    const product = await post(`/api/v1/catalog/stores/${storeA}/products`, vendorA.owner, { title: 'Subtotal Limit Product', description: 'Fixture for checkout subtotal bounds', brand: 'Stoopy' }).expect(201);
    const variants: string[] = [];
    for (let i = 0; i < 11; i++) {
      const variant = await post(`/api/v1/catalog/products/${product.body.productId}/variants`, vendorA.owner, { sku: `LIMIT-${i}-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '9007199254740991', currency: 'BDT' }).expect(201);
      variants.push(variant.body.id);
    }
    await post(`/api/v1/catalog/products/${product.body.productId}/submit`, vendorA.owner, { version: 1 }).expect(201);
    await post(`/api/v1/catalog/admin/products/${product.body.productId}/review`, productModerator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${product.body.productId}/publish`, productModerator, { version: 3, reason: 'approved for public catalog' }).expect(201);
    for (const variantId of variants) {
      await post(`/api/v1/inventory/variants/${variantId}/initialize`, vendorA.owner, { reorderLevel: 0 }).expect(201);
      await post(`/api/v1/inventory/variants/${variantId}/adjustments`, vendorA.owner, { version: 1, delta: 100, commandKey: `stock-${randomUUID()}`, reason: 'subtotal boundary fixture' }).expect(201);
    }
    const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
    let version = cart.body.version as number;
    for (const variantId of variants) version = (await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId, quantity: 100, expectedVersion: version }).expect(201)).body.version;
    const key = `quote-${randomUUID()}`;
    const payload = { expectedVersion: version, destinationCityId: cityId, commandKey: key };
    for (let i = 0; i < 2; i++) {
      const rejected = await post(`/api/v1/commerce/carts/${cart.body.cartId}/quotes`, buyer, payload).expect(409);
      expect(rejected.body.code).toBe('CHECKOUT_SUBTOTAL_LIMIT');
    }
    const rollback = await asSuper(u.privileged, c => c.query(`SELECT (SELECT count(*)::int FROM "CheckoutQuote" WHERE "cartId"=$1) AS quotes, (SELECT count(*)::int FROM "InventoryReservation" WHERE "userId"=$2) AS reservations, (SELECT coalesce(sum(reserved),0)::int FROM "Inventory" WHERE "variantId"=ANY($3::uuid[])) AS reserved, (SELECT coalesce(sum("onHand"),0)::int FROM "Inventory" WHERE "variantId"=ANY($3::uuid[])) AS onhand`, [cart.body.cartId, buyer.userId, variants]));
    expect(rollback.rows[0]).toEqual({ quotes: 0, reservations: 0, reserved: 0, onhand: 1100 });
    const reduced = await del(`/api/v1/commerce/carts/${cart.body.cartId}/items/${variants[10]}?expectedVersion=${version}`, buyer).expect(200);
    const accepted = await post(`/api/v1/commerce/carts/${cart.body.cartId}/quotes`, buyer, { expectedVersion: reduced.body.version, destinationCityId: cityId, commandKey: `quote-${randomUUID()}` }).expect(201);
    expect(accepted.body.subtotalMinor).toBe('9007199254740991000');
    expect(accepted.body.items).toHaveLength(10);
    const released = await post(`/api/v1/commerce/quotes/${accepted.body.quoteId}/release`, buyer, { version: accepted.body.version, reason: 'subtotal boundary test cleanup' }).expect(201);
    expect(released.body.state).toBe('RELEASED');
    const after = await asSuper(u.privileged, c => c.query(`SELECT coalesce(sum(reserved),0)::int AS reserved, coalesce(sum("onHand"),0)::int AS onhand FROM "Inventory" WHERE "variantId"=ANY($1::uuid[])`, [variants]));
    expect(after.rows[0]).toEqual({ reserved: 0, onhand: 1100 });
  }, 120000);

  it('expires whole quotes in small batches and coordinates with release and other workers', async () => {
    const fixtures: { buyer: any; quoteId: string; reservations: string[] }[] = [];
    for (let n = 0; n < 4; n++) {
      const buyer = await makeUser(`expiry-race-${n}`);
      const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
      let version = cart.body.version;
      for (const variantId of [variantA, variantB]) {
        const added = await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId, quantity: 1, expectedVersion: version }).expect(201);
        version = added.body.version;
      }
      const quote = await post(`/api/v1/commerce/carts/${cart.body.cartId}/quotes`, buyer, { expectedVersion: version, destinationCityId: cityId, commandKey: `expiry-${randomUUID()}`, ttlSeconds: 60 }).expect(201);
      fixtures.push({ buyer, quoteId: quote.body.quoteId, reservations: quote.body.items.map((i: any) => i.reservationId) });
    }
    // Wait until both lines of each quote have expired, using the same real
    // clock as the API and PostgreSQL rather than disabling integrity triggers.
    await new Promise(resolve => setTimeout(resolve, 61000));
    const releaseHolder = new pg.Client({ connectionString: u.privileged });
    const workerHolder = new pg.Client({ connectionString: u.privileged });
    const secondWorkerHolder = new pg.Client({ connectionString: u.privileged });
    const stockHolder = new pg.Client({ connectionString: u.privileged });
    await releaseHolder.connect(); await workerHolder.connect();
    await secondWorkerHolder.connect(); await stockHolder.connect();
    const errors: string[] = [];
    const log = { info: () => undefined, error: (_name: string, fields: any) => errors.push(fields.error) } as any;
    try {
      for (const [holder, fixture] of [[releaseHolder, fixtures[1]!], [workerHolder, fixtures[2]!], [secondWorkerHolder, fixtures[3]!]] as const) {
        await holder.query('BEGIN');
        await holder.query("SELECT set_config('app.is_super','true',true)");
        await holder.query('SELECT id FROM "CheckoutQuote" WHERE id=$1 FOR UPDATE', [fixture.quoteId]);
      }
      // A limit of one is a soft budget: all lines in one quote close together.
      expect(await runInventoryExpiryTick(privilegedPool, log, 1)).toBe(2);
      expect((await get(`/api/v1/commerce/quotes/${fixtures[0]!.quoteId}`, fixtures[0]!.buyer).expect(200)).body).toMatchObject({ state: 'EXPIRED', version: 2 });
      // All remaining quotes are held: expiry must skip them, without taking
      // an inventory lock that would deadlock the release path.
      expect(await runInventoryExpiryTick(privilegedPool, log, 1)).toBe(0);
      const release = post(`/api/v1/commerce/quotes/${fixtures[1]!.quoteId}/release`, fixtures[1]!.buyer, { version: 1, reason: 'release during expiry race' }).then((r: any) => r);
      const deadline = Date.now() + 10000;
      let blocked = false;
      while (Date.now() < deadline) {
        blocked = (await privilegedPool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%FROM "CheckoutQuote"%FOR UPDATE%') AS blocked`)).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(blocked).toBe(true);
      expect(await runInventoryExpiryTick(privilegedPool, log, 1)).toBe(0);
      await releaseHolder.query('COMMIT');
      const released = await release;
      expect(released.status).toBe(201);
      expect(released.body.state).toBe('RELEASED');
      // Force separate expiry workers to hold different quote locks and then
      // wait on the same lowest-ordered inventory row. This is not merely a
      // sequential retry: both transactions must overlap before release.
      await stockHolder.query('BEGIN');
      await stockHolder.query("SELECT set_config('app.is_super','true',true)");
      await stockHolder.query('SELECT id FROM "Inventory" WHERE "variantId"=$1 FOR UPDATE', [[variantA, variantB].sort()[0]]);
      await workerHolder.query('COMMIT');
      await secondWorkerHolder.query('COMMIT');
      const work = [runInventoryExpiryTick(privilegedPool, log, 1), runInventoryExpiryTick(privilegedPool, log, 1)];
      const workDeadline = Date.now() + 10000;
      let workWaiters = 0;
      while (Date.now() < workDeadline) {
        workWaiters = (await privilegedPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%gs_expire_inventory_reservations%'`)).rows[0].n;
        if (workWaiters >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(workWaiters).toBeGreaterThanOrEqual(2);
      await stockHolder.query('COMMIT');
      const parallel = await Promise.all(work);
      expect(parallel.sort()).toEqual([2, 2]);
      for (const fixture of fixtures.slice(2)) {
        expect((await get(`/api/v1/commerce/quotes/${fixture.quoteId}`, fixture.buyer).expect(200)).body).toMatchObject({ state: 'EXPIRED', version: 2 });
      }
      const afterExpiry = await post(`/api/v1/commerce/quotes/${fixtures[2]!.quoteId}/release`, fixtures[2]!.buyer, { version: 1, reason: 'late release after expiry' }).expect(201);
      expect(afterExpiry.body).toMatchObject({ state: 'EXPIRED', duplicate: true });
      expect(errors).toEqual([]);
    } finally {
      await releaseHolder.query('ROLLBACK').catch(() => undefined);
      await workerHolder.query('ROLLBACK').catch(() => undefined);
      await secondWorkerHolder.query('ROLLBACK').catch(() => undefined);
      await stockHolder.query('ROLLBACK').catch(() => undefined);
      await releaseHolder.end(); await workerHolder.end();
      await secondWorkerHolder.end(); await stockHolder.end();
    }
    for (const [index, fixture] of fixtures.entries()) {
      const records = await asSuper(u.privileged, c => c.query(`SELECT
        (SELECT count(*)::int FROM "InventoryReservation" WHERE id=ANY($1::uuid[]) AND state=$2::"InventoryReservationState") AS closed,
        (SELECT count(*)::int FROM "InventoryMovement" WHERE "reservationId"=ANY($1::uuid[]) AND kind=$3::"InventoryMovementKind") AS movements,
        (SELECT count(*)::int FROM "OutboxEvent" WHERE "eventKey"=$4) AS quote_events`,
        [fixture.reservations, index === 1 ? 'RELEASED' : 'EXPIRED', index === 1 ? 'RELEASE' : 'EXPIRE', index === 1 ? `checkout-quote-released-${fixture.quoteId}` : `checkout-quote-expired-${fixture.quoteId}`]));
      expect(records.rows[0]).toEqual({ closed: 2, movements: 2, quote_events: 1 });
    }
    expect((await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200)).body.reserved).toBe(0);
    expect((await get(`/api/v1/inventory/variants/${variantB}`, vendorB.owner).expect(200)).body.reserved).toBe(0);
    expect(await runInventoryExpiryTick(privilegedPool, log, 100)).toBe(0);
  }, 100000);

  it('rehearses the function upgrade with an existing reserved quote without changing state or grants', async () => {
    const target = new URL(u.owner);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/getstoopy_test') {
      throw new Error('Migration rehearsal requires the local disposable getstoopy_test database');
    }
    const buyer = await makeUser('expiry-upgrade');
    const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
    const added = await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId: variantA, quantity: 1, expectedVersion: cart.body.version }).expect(201);
    const quote = await post(`/api/v1/commerce/carts/${cart.body.cartId}/quotes`, buyer, { expectedVersion: added.body.version, destinationCityId: cityId, commandKey: `upgrade-${randomUUID()}` }).expect(201);
    const ownerClient = new pg.Client({ connectionString: u.owner });
    await ownerClient.connect();
    try {
      await ownerClient.query('BEGIN');
      // gs_owner is not gs_privileged; FORCE RLS permits this buyer's quote
      // only with the correct actor context, not an app.is_super flag.
      await ownerClient.query("SELECT set_config('app.user_id',$1,true)", [buyer.userId]);
      const priorMigration = readFileSync(new URL('../../packages/db/prisma/migrations/0020_inventory_reservation_foundation/migration.sql', import.meta.url), 'utf8');
      const marker = 'CREATE OR REPLACE FUNCTION gs_expire_inventory_reservations(batch_limit INTEGER)';
      const start = priorMigration.indexOf(marker);
      expect(start).toBeGreaterThan(0);
      const newMigration = readFileSync(new URL('../../packages/db/prisma/migrations/0073_quote_expiry_locking/migration.sql', import.meta.url), 'utf8');
      // Replacement and rehearsal are rolled back, so no other test sees a
      // legacy function. The pre-existing quote models an in-flight rollout.
      await ownerClient.query(priorMigration.slice(start));
      const snapshot = async () => {
        const row = (await ownerClient.query(`SELECT q.state,q.version,
          (SELECT count(*)::int FROM "InventoryReservation" r JOIN "CheckoutQuoteItem" qi ON qi."reservationId"=r.id WHERE qi."quoteId"=q.id AND r.state='ACTIVE') AS active,
          has_function_privilege('gs_privileged','gs_expire_inventory_reservations(integer)','EXECUTE') AS privileged_execute,
          has_function_privilege('gs_runtime','gs_expire_inventory_reservations(integer)','EXECUTE') AS runtime_execute
          FROM "CheckoutQuote" q WHERE q.id=$1`, [quote.body.quoteId])).rows[0];
        // Inventory is vendor-scoped. Inspect it using the separate privileged
        // connection; owner and buyer RLS must not be bypassed in the rehearsal.
        const stock = await asSuper(u.privileged, c => c.query('SELECT reserved FROM "Inventory" WHERE "variantId"=$1', [variantA]));
        return { ...row, reserved: stock.rows[0].reserved };
      };
      const before = await snapshot();
      expect(before).toMatchObject({ state: 'RESERVED', version: 1, active: 1, privileged_execute: true });
      await ownerClient.query(newMigration);
      expect(await snapshot()).toEqual(before);
      const definition = (await ownerClient.query(`SELECT pg_get_functiondef('gs_expire_inventory_reservations(integer)'::regprocedure) AS body`)).rows[0].body;
      expect(definition).toContain('SKIP LOCKED');
      expect(definition).toContain('expiry_quote_item_limit');
    } finally {
      await ownerClient.query('ROLLBACK').catch(() => undefined);
      await ownerClient.end();
      await post(`/api/v1/commerce/quotes/${quote.body.quoteId}/release`, buyer, { version: 1, reason: 'migration rehearsal cleanup' }).expect(201);
    }
  });

  it('waits for every quote line to expire while processing an older standalone hold', async () => {
    const buyer = await makeUser('staggered-expiry');
    const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
    let version = cart.body.version;
    for (const variantId of [variantA, variantB]) {
      const added = await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId, quantity: 1, expectedVersion: version }).expect(201);
      version = added.body.version;
    }
    const quoteId = randomUUID();
    const standaloneId = randomUUID();
    const firstId = randomUUID(); const secondId = randomUUID();
    // Time-offset fixtures are inserted through all normal PostgreSQL guards;
    // no trigger disabling or production data is involved.
    await asSuper(u.privileged, async c => {
      async function reserve(variantId: string, reservationId: string, expiry: string) {
        const inv = (await c.query('SELECT * FROM "Inventory" WHERE "variantId"=$1 FOR UPDATE', [variantId])).rows[0];
        const key = `fixture-${reservationId}`;
        const hash = createHash('sha256').update(key).digest('hex');
        await c.query(`INSERT INTO "InventoryReservation"(id,"inventoryId","userId","commandKey","payloadHash",quantity,"createdAt","expiresAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,1,now()-interval '61 seconds',now()+$6::interval,now())`, [reservationId, inv.id, buyer.userId, key, hash, expiry]);
        const updated = (await c.query('UPDATE "Inventory" SET reserved=reserved+1,version=version+1,"updatedAt"=now() WHERE id=$1 RETURNING *', [inv.id])).rows[0];
        await c.query(`INSERT INTO "InventoryMovement"(id,"inventoryId","inventoryVersion",kind,"commandKey","payloadHash","reservationId","onHandDelta","reservedDelta","onHandAfter","reservedAfter",reason,"actorUserId")
          VALUES (gen_random_uuid(),$1,$2,'RESERVE',$3,$4,$5,0,1,$6,$7,'checkout stock reservation',$8)`, [inv.id, updated.version, `reserve:${reservationId}`, hash, reservationId, updated.onHand, updated.reserved, buyer.userId]);
      }
      await reserve(variantA, firstId, '-1 second');
      await reserve(variantB, secondId, '120 seconds');
      await reserve(variantA, standaloneId, '-2 seconds');
      const key = `fixture-quote-${quoteId}`;
      await c.query(`INSERT INTO "CheckoutQuote"(id,"userId","countryId","cartId","cartVersion","destinationCityId","commandKey","payloadHash",currency,"subtotalMinor","createdAt","expiresAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'BDT',1250,now()-interval '61 seconds',now()-interval '1 second',now())`,
        [quoteId, buyer.userId, countryId, cart.body.cartId, version, cityId, key, createHash('sha256').update(key).digest('hex')]);
      for (const [vendor, reservationId] of [[vendorA, firstId], [vendorB, secondId]] as const) {
        const v = (await c.query(`SELECT v.id,v.sku,v."priceAmountMinor",v.currency,p.id AS "productId",p.title
          FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE v.id=$1`, [vendor.variantId])).rows[0];
        const groupId = randomUUID();
        await c.query(`INSERT INTO "CheckoutQuoteGroup"(id,"quoteId","vendorId","storeId",currency,"subtotalMinor") VALUES ($1,$2,$3,$4,$5,$6)`, [groupId, quoteId, vendor.vendorId, vendor.storeId, v.currency, v.priceAmountMinor]);
        await c.query(`INSERT INTO "CheckoutQuoteItem"(id,"quoteId","groupId","reservationId","variantId","productId","productTitle",sku,quantity,"unitPriceMinor","lineTotalMinor",currency)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9)`, [quoteId, groupId, reservationId, v.id, v.productId, v.title, v.sku, v.priceAmountMinor, v.currency]);
      }
    });
    try {
      const errors: string[] = [];
      const log = { info: () => undefined, error: (_name: string, fields: any) => errors.push(fields.error) } as any;
      expect(await runInventoryExpiryTick(privilegedPool, log, 10)).toBe(1);
      const state = await asSuper(u.privileged, c => c.query(`SELECT id,state FROM "InventoryReservation" WHERE id=ANY($1::uuid[]) ORDER BY id`, [[firstId, secondId, standaloneId]]));
      expect(state.rows.find((r: any) => r.id === standaloneId)?.state).toBe('EXPIRED');
      expect(state.rows.find((r: any) => r.id === firstId)?.state).toBe('ACTIVE');
      expect(state.rows.find((r: any) => r.id === secondId)?.state).toBe('ACTIVE');
      expect((await get(`/api/v1/commerce/quotes/${quoteId}`, buyer).expect(200)).body.state).toBe('RESERVED');
      expect(errors).toEqual([]);
    } finally {
      await post(`/api/v1/commerce/quotes/${quoteId}/release`, buyer, { version: 1, reason: 'staggered expiry test cleanup' }).expect(201);
    }
  });

  it('enforces RLS, append-only quote snapshots and deferred total/reservation consistency', async () => {
    const cart = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
    const cartId = cart.body.cartId;
    await expect(asUser(u.runtime, customer.userId, c => c.query(`INSERT INTO "Cart"(id,"userId","countryId",currency,"updatedAt") VALUES (gen_random_uuid(),$1,$2,'BDT',now())`, [customer.userId, countryId]))).rejects.toThrow(/permission denied/);
    const quote = await asSuper(u.privileged, async c => (await c.query(`SELECT id FROM "CheckoutQuote" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [customer.userId])).rows[0]);
    await expect(asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "CheckoutQuote" WHERE id=$1`, [quote.id]))).resolves.toMatchObject({ rowCount: 0 });
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "CheckoutQuoteItem" SET "productTitle"='tampered' WHERE "quoteId"=$1`, [quote.id]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "CheckoutQuote" SET "subtotalMinor"="subtotalMinor"+1, version=version+1 WHERE id=$1`, [quote.id]))).rejects.toThrow(/checkout_quote_immutable_fields/);
    const cartRow = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "Cart" WHERE id=$1`, [cartId])).rows[0]);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "CheckoutQuote"(id,"userId","countryId","cartId","cartVersion","destinationCityId","commandKey","payloadHash",currency,"subtotalMinor","expiresAt","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'BDT',100,now()+interval '900 seconds',now())`, [customer.userId, countryId, cartId, cartRow.version, cityId, `empty-${randomUUID().slice(0, 8)}`, createHash('sha256').update('empty').digest('hex')]))).rejects.toThrow(/checkout_quote_empty|checkout_quote_total_mismatch/);
  });
});

describe('checkout destination must be serviceable before stock is reserved', () => {
  async function freshCart() {
    const created = await post('/api/v1/commerce/carts', customer, { countryId }).expect(201);
    const cartId = created.body.cartId as string;
    let version = created.body.version as number;
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, customer, { variantId: variantA, quantity: 1, expectedVersion: version }).expect(201);
    version = added.body.version as number;
    return { cartId, version };
  }

  it('rejects a destination that does not exist and reserves nothing', async () => {
    const { cartId, version } = await freshCart();
    const missingCity = randomUUID();
    // Other suites hold reservations on this variant, so compare before/after
    // rather than asserting a global count of zero.
    const countActive = async () => (await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "InventoryReservation" ir JOIN "Inventory" i ON i."id"=ir."inventoryId" WHERE i."variantId"=$1 AND ir.state='ACTIVE'`, [variantA]))).rows[0].n as number;
    // The cart is unique per (user, country), so it already carries quotes from
    // earlier tests. Compare counts across this one rejected attempt.
    const countQuotes = async () => (await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "CheckoutQuote" WHERE "cartId"=$1`, [cartId]))).rows[0].n as number;
    const before = await countActive();
    const quotesBefore = await countQuotes();
    const res = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: missingCity, commandKey: `dest-missing-${randomUUID().slice(0, 8)}`,
    }).expect(409);
    expect(res.body.code).toBe('CHECKOUT_DESTINATION_NOT_SERVICEABLE');
    expect(await countQuotes()).toBe(quotesBefore);
    expect(await countActive()).toBe(before);
  });

  it('rejects an active city in the same country that has no approved coverage', async () => {
    const uncoveredCity = await asSuper(u.privileged, async c => {
      const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), countryId, `unc-reg-${randomUUID().slice(0, 8)}`, 'Uncovered']);
      const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), region.rows[0].id, `unc-dist-${randomUUID().slice(0, 8)}`, 'Uncovered']);
      return (await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,'CITY','ACTIVE') RETURNING id`, [randomUUID(), district.rows[0].id, `unc-city-${randomUUID().slice(0, 8)}`, 'Uncovered City'])).rows[0].id as string;
    });
    const { cartId, version } = await freshCart();
    const res = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: uncoveredCity, commandKey: `dest-uncovered-${randomUUID().slice(0, 8)}`,
    }).expect(409);
    expect(res.body.code).toBe('CHECKOUT_DESTINATION_NOT_SERVICEABLE');
  });

  it('rejects a city from another country even when that city is active', async () => {
    const foreignCity = await asSuper(u.privileged, async c => {
      const country = (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE') RETURNING id`, [randomUUID(), `X${randomUUID().slice(0, 1).toUpperCase()}${Math.floor(Math.random() * 9)}`, 'Foreign', 'USD', '+1', 'UTC'])).rows[0].id as string;
      const region = (await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), country, `for-reg-${randomUUID().slice(0, 8)}`, 'Foreign'])).rows[0].id as string;
      const district = (await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [randomUUID(), region, `for-dist-${randomUUID().slice(0, 8)}`, 'Foreign'])).rows[0].id as string;
      return (await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,'CITY','ACTIVE') RETURNING id`, [randomUUID(), district, `for-city-${randomUUID().slice(0, 8)}`, 'Foreign City'])).rows[0].id as string;
    });
    const { cartId, version } = await freshCart();
    const res = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: foreignCity, commandKey: `dest-foreign-${randomUUID().slice(0, 8)}`,
    }).expect(409);
    expect(res.body.code).toBe('CHECKOUT_DESTINATION_NOT_SERVICEABLE');
  });

  it('still accepts the covered fixture city', async () => {
    const { cartId, version } = await freshCart();
    const quote = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: cityId, commandKey: `dest-ok-${randomUUID().slice(0, 8)}`,
    }).expect(201);
    expect(quote.body.destinationCityId).toBe(cityId);
    await post(`/api/v1/commerce/quotes/${quote.body.quoteId}/release`, customer, { version: 1, reason: 'test cleanup release' }).expect(201);
  });

  it('names the existing quote on a duplicate reservation so a reloaded page can still release it', async () => {
    const { cartId, version } = await freshCart();
    const first = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: cityId, commandKey: `recover-first-${randomUUID().slice(0, 8)}`,
    }).expect(201);

    // A buyer who reloaded checkout has a new command key and no quote id in
    // memory. Without the id in this error the reserved stock was unreachable
    // until the quote expired.
    const second = await post(`/api/v1/commerce/carts/${cartId}/quotes`, customer, {
      expectedVersion: version, destinationCityId: cityId, commandKey: `recover-second-${randomUUID().slice(0, 8)}`,
    }).expect(409);
    expect(second.body.code).toBe('CHECKOUT_QUOTE_ALREADY_RESERVED');
    // The error filter emits only {code,message,requestId} by design, so the id
    // is carried by the cart resource instead.
    expect(Object.keys(second.body).sort()).toEqual(['code', 'message', 'requestId']);
    const reloaded = await get(`/api/v1/commerce/carts/${cartId}`, customer).expect(200);
    expect(reloaded.body.activeQuoteId).toBe(first.body.quoteId);

    const recovered = await get(`/api/v1/commerce/quotes/${reloaded.body.activeQuoteId}`, customer).expect(200);
    expect(recovered.body.state).toBe('RESERVED');
    // Another user must not be able to read it just because the id is known.
    await get(`/api/v1/commerce/quotes/${reloaded.body.activeQuoteId}`, stranger).expect(404);

    const released = await post(`/api/v1/commerce/quotes/${reloaded.body.activeQuoteId}/release`, customer, {
      version: recovered.body.version, reason: 'released after page reload',
    }).expect(201);
    expect(released.body.state).toBe('RELEASED');
    const afterRelease = await get(`/api/v1/commerce/carts/${cartId}`, customer).expect(200);
    expect(afterRelease.body.activeQuoteId).toBeNull();
  });
});

describe('concurrent cart creation', () => {
  it('returns one cart for overlapping equivalent requests, without blocking a different buyer', async () => {
    const buyer = await makeUser(`cart-race-${randomUUID().slice(0, 8)}`);
    const other = await makeUser(`cart-independent-${randomUUID().slice(0, 8)}`);
    const holder = new pg.Client({ connectionString: u.privileged });
    await holder.connect();
    let first: Promise<any> | undefined;
    let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`cart-create:${buyer.userId.toLowerCase()}:${countryId.toLowerCase()}`]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      first = post('/api/v1/commerce/carts', buyer, { countryId }).then((res: any) => res);
      second = post('/api/v1/commerce/carts', buyer, { countryId: countryId.toUpperCase() }).then((res: any) => res);
      const deadline = Date.now() + 4000;
      let blocked = 0;
      while (Date.now() < deadline) {
        const result = await privilegedPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE state='active' AND wait_event_type='Lock' AND $1 = ANY(pg_blocking_pids(pid))`, [holderPid]);
        blocked = result.rows[0].n;
        if (blocked >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(blocked).toBe(2);
      const unrelated = await post('/api/v1/commerce/carts', other, { countryId }).expect(201);
      expect(unrelated.body.duplicate).toBe(false);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const [a, b] = await Promise.all([first!, second!]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.cartId).toBe(b.body.cartId);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    const rows = await asSuper(u.privileged, c => c.query(`SELECT
      (SELECT count(*)::int FROM "Cart" WHERE "userId"=$1 AND "countryId"=$2) AS carts,
      (SELECT count(*)::int FROM "AuditLog" WHERE "resourceId"=$3 AND action='commerce.cart.created') AS audits,
      (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateId"=$3 AND "eventType"='commerce.cart.created') AS events`,
      [buyer.userId, countryId, a.body.cartId]));
    expect(rows.rows[0]).toMatchObject({ carts: 1, audits: 1, events: 1 });
  });
});

describe('concurrent cart read consistency', () => {
  async function setup() {
    const buyer = await makeUser(`cart-read-${randomUUID().slice(0, 8)}`);
    const created = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
    const cartId = created.body.cartId as string;
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, buyer, { variantId: variantA, quantity: 1, expectedVersion: created.body.version }).expect(201);
    return { buyer, cartId, version: added.body.version as number };
  }
  async function waitForBlockedBy(pid: number) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const rows = await privilegedPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE state='active' AND wait_event_type='Lock' AND $1 = ANY(pg_blocking_pids(pid))`, [pid]);
      if (rows.rows[0].n >= 1) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Expected the cart request to wait for the fixture lock');
  }
  it('GET uses one snapshot when an item and cart version change mid-read', async () => {
    const { buyer, cartId, version } = await setup();
    const holder = new pg.Client({ connectionString: u.privileged });
    await holder.connect();
    let pending: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('LOCK TABLE "CartItem" IN ACCESS EXCLUSIVE MODE');
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = get(`/api/v1/commerce/carts/${cartId}`, buyer).then((res: any) => res);
      await waitForBlockedBy(pid);
      // The trigger advances the cart version with this line update.
      await holder.query('UPDATE "CartItem" SET quantity=2 WHERE "cartId"=$1 AND "variantId"=$2', [cartId, variantA]);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const response = await pending!;
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(version);
    expect(response.body.items[0].quantity).toBe(1);
    const fresh = await get(`/api/v1/commerce/carts/${cartId}`, buyer).expect(200);
    expect(fresh.body.version).toBe(version + 1);
    expect(fresh.body.items[0].quantity).toBe(2);
  });
  it('get-or-create waits for the cart lock and returns the updated version and lines', async () => {
    const { buyer, cartId, version } = await setup();
    const holder = new pg.Client({ connectionString: u.privileged });
    await holder.connect();
    let pending: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "Cart" WHERE id=$1 FOR UPDATE', [cartId]);
      const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = post('/api/v1/commerce/carts', buyer, { countryId }).then((res: any) => res);
      await waitForBlockedBy(pid);
      await holder.query('UPDATE "CartItem" SET quantity=2 WHERE "cartId"=$1 AND "variantId"=$2', [cartId, variantA]);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const response = await pending!;
    expect(response.status).toBe(201);
    expect(response.body.duplicate).toBe(true);
    expect(response.body.version).toBe(version + 1);
    expect(response.body.items[0].quantity).toBe(2);
  });
});

describe('concurrent checkout reservation idempotency', () => {
  // Hold the cart row until both HTTP requests have reached the database. This
  // forces the second request to overlap the first, rather than relying on timing
  // or merely testing a sequential replay. One waiter is on the cart; with the
  // buyer lock the other waits on the advisory lock, without it both wait on cart.
  async function overlapQuoteRequests(changedPayload: boolean) {
    const buyer = await makeUser(`quote-race-${randomUUID().slice(0, 8)}`);
    const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
    const cartId = cart.body.cartId as string;
    const added = await post(`/api/v1/commerce/carts/${cartId}/items`, buyer, { variantId: variantA, quantity: 1, expectedVersion: cart.body.version }).expect(201);
    const body = { expectedVersion: added.body.version as number, destinationCityId: cityId, commandKey: `race-${randomUUID()}` };
    const baseline = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    const holder = new pg.Client({ connectionString: u.privileged });
    await holder.connect();
    let first: Promise<any> | undefined;
    let second: Promise<any> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "Cart" WHERE id=$1 FOR UPDATE', [cartId]);
      const waitForRequests = async (count: number) => {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const waiting = await privilegedPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE pid <> pg_backend_pid() AND state = 'active' AND wait_event_type = 'Lock'
              AND (query LIKE '%pg_advisory_xact_lock%' OR query LIKE '%FROM "Cart"%FOR UPDATE%')`);
          if (waiting.rows[0].n >= count) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error(`Expected ${count} blocked quote requests`);
      };
      first = post(`/api/v1/commerce/carts/${cartId}/quotes`, buyer, body).then((res: any) => res);
      await waitForRequests(1);
      const secondBody = changedPayload ? { ...body, expectedVersion: body.expectedVersion + 1 } : body;
      second = post(`/api/v1/commerce/carts/${cartId}/quotes`, buyer, secondBody).then((res: any) => res);
      await waitForRequests(2);
      await holder.query('COMMIT');
    } finally {
      // Also unblock requests on failure, so the suite can clean up its server.
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const [a, b] = await Promise.all([first!, second!]);
    expect(a.status).toBe(201);
    if (changedPayload) {
      expect(b.status).toBe(409);
      expect(b.body.code).toBe('CHECKOUT_IDEMPOTENCY_CONFLICT');
    } else {
      expect(b.status).toBe(201);
      expect(b.body.quoteId).toBe(a.body.quoteId);
      expect(b.body.duplicate).toBe(true);
    }
    expect(a.body.duplicate).toBe(false);
    const rows = await asSuper(u.privileged, c => c.query(`SELECT count(*)::int AS n FROM "CheckoutQuote" WHERE "cartId"=$1`, [cartId]));
    expect(rows.rows[0].n).toBe(1);
    const inv = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    expect(inv.body.reserved).toBe(baseline.body.reserved + 1);
    await post(`/api/v1/commerce/quotes/${a.body.quoteId}/release`, buyer, { version: a.body.version, reason: 'concurrent quote test cleanup' }).expect(201);
    const after = await get(`/api/v1/inventory/variants/${variantA}`, vendorA.owner).expect(200);
    expect(after.body.reserved).toBe(baseline.body.reserved);
  }

  it('returns the original quote when the same command arrives concurrently', async () => {
    await overlapQuoteRequests(false);
  });
  it('returns an idempotency conflict for a concurrently reused key with different input', async () => {
    await overlapQuoteRequests(true);
  });
});

describe('competing buyers reserving the last unit', () => {
  it('creates only one quote and never over-reserves stock', async () => {
    const vendor = await setupVendor(`last-unit-${randomUUID().slice(0, 8)}`, '199', 1);
    const buyers = await Promise.all([makeUser('stock-race-a'), makeUser('stock-race-b')]);
    const carts = [];
    for (const buyer of buyers) {
      const cart = await post('/api/v1/commerce/carts', buyer, { countryId }).expect(201);
      const added = await post(`/api/v1/commerce/carts/${cart.body.cartId}/items`, buyer, { variantId: vendor.variantId, quantity: 1, expectedVersion: cart.body.version }).expect(201);
      carts.push({ id: cart.body.cartId as string, version: added.body.version as number });
    }
    const holder = new pg.Client({ connectionString: u.privileged });
    await holder.connect();
    let requests: Promise<any>[] = [];
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.is_super','true',true)");
      await holder.query('SELECT id FROM "Inventory" WHERE "variantId"=$1 FOR UPDATE', [vendor.variantId]);
      requests = buyers.map((buyer, i) => post(`/api/v1/commerce/carts/${carts[i]!.id}/quotes`, buyer, {
        expectedVersion: carts[i]!.version, destinationCityId: cityId, commandKey: `last-unit-${randomUUID()}`,
      }).then((res: any) => res));
      const deadline = Date.now() + 10000;
      let waiting = 0;
      while (Date.now() < deadline) {
        waiting = (await privilegedPool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND state='active' AND wait_event_type='Lock'
            AND (query LIKE '%FROM "Inventory"%FOR UPDATE%' OR query LIKE '%FROM "ProductVariant"%FOR UPDATE%')`)).rows[0].n;
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    const results = await Promise.all(requests);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const winnerIndex = results.findIndex(r => r.status === 201);
    const winner = results[winnerIndex];
    const loser = results.find(r => r.status === 409);
    expect(loser.body.code).toBe('INSUFFICIENT_STOCK');
    expect(winner.body.state).toBe('RESERVED');
    const stock = await asSuper(u.privileged, c => c.query(`SELECT i."onHand", i.reserved,
      (SELECT count(*)::int FROM "InventoryReservation" r WHERE r."inventoryId"=i.id AND r.state='ACTIVE') AS active,
      (SELECT count(*)::int FROM "CheckoutQuoteItem" qi JOIN "CheckoutQuote" q ON q.id=qi."quoteId" WHERE qi."variantId"=i."variantId" AND q.state='RESERVED') AS quotes
      FROM "Inventory" i WHERE i."variantId"=$1`, [vendor.variantId]));
    expect(stock.rows[0]).toEqual({ onHand: 1, reserved: 1, active: 1, quotes: 1 });
    await post(`/api/v1/commerce/quotes/${winner.body.quoteId}/release`, buyers[winnerIndex], { version: winner.body.version, reason: 'last unit test cleanup' }).expect(201);
    const after = await get(`/api/v1/inventory/variants/${vendor.variantId}`, vendor.owner).expect(200);
    expect(after.body).toMatchObject({ onHand: 1, reserved: 0, availableToPromise: 1 });
  }, 120000);
});
