import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { publishOutboxBatch } from '../../packages/events/src/index';
import { urls, asSuper, asUser } from './helpers';
import { InventoryService } from '../../apps/api/src/inventory/inventory.service';
import { runInventoryExpiryTick } from '../../apps/worker/src/inventory-expiry';

const u = urls();
let app: any;
let inventoryService: InventoryService;
const origin = 'http://localhost:3000';
let countryId: string;
let cityId: string;
let pool: pg.Pool;
let privilegedPool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-inventory-test-${randomUUID()}`;
let owner: any;
let staff: any;
let vendorId: string;
let storeId: string;
let productId: string;
let variantId: string;
let kycCaseId: string;
let kycReviewer: any;
let productModerator: any;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `inventory-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Inventory ${label}`]);
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
async function grantKeys(user: { userId: string; sessionId: string }, keys: string[]) {
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `inventory-role-${randomUUID()}`, 'Inventory Role']);
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
  const id = randomUUID(); const hash = createHash('sha256').update(`inventory-evidence-${id}`).digest('hex');
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

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  inventoryService = app.get(InventoryService);
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `inv-reg-${randomUUID().slice(0, 8)}`, 'Inventory', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `inv-dist-${randomUUID().slice(0, 8)}`, 'Inventory', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `inv-city-${randomUUID().slice(0, 8)}`, 'Inventory', 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  privilegedPool = new pg.Pool({ connectionString: u.privileged, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();

  owner = await makeUser('owner');
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Inventory Vendor' }).expect(201);
  vendorId = vendor.body.vendorId;
  kycReviewer = await makeUser('kyc-reviewer'); await grantKeys(kycReviewer, ['kyc:case:review']);
  const kyc = await post('/api/v1/kyc/cases', owner, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  kycCaseId = kyc.body.caseId;
  const docId = await makeStorageObject(owner.userId);
  await post(`/api/v1/kyc/cases/${kycCaseId}/documents`, owner, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${kycCaseId}/submit`, owner, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 2, commandKey: `start-${kycCaseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 3, commandKey: `approve-${kycCaseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'Inventory Store', slug: `inventory-store-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  storeId = store.body.storeId;
  const storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate']);
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Inventory Product', description: 'A product used for inventory integration tests', brand: 'Stoopy' }).expect(201);
  productId = product.body.productId;
  const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `INV-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
  variantId = variant.body.id;
  staff = await makeUser('staff');
  await setStepUp(owner);
  await post(`/api/v1/parties/vendors/${vendorId}/memberships`, owner, { userId: staff.userId, role: 'STAFF' }).expect(201);
  productModerator = await makeUser('product-moderator'); await grantKeys(productModerator, ['catalog:product:review', 'catalog:product:publish']);
});
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (privilegedPool) await privilegedPool.end();
  if (app) await app.close();
});

describe('inventory and stock reservation foundation', () => {
  it('initializes and adjusts vendor stock with membership, idempotency, version and bounds guards', async () => {
    const initialized = await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 2 }).expect(201);
    expect(initialized.body.onHand).toBe(0);
    expect(initialized.body.availableToPromise).toBe(0);
    const duplicate = await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 2 }).expect(201);
    expect(duplicate.body.duplicate).toBe(true);
    await post(`/api/v1/inventory/variants/${variantId}/initialize`, owner, { reorderLevel: 3 }).expect(409);
    const stranger = await makeUser('stranger');
    await get(`/api/v1/inventory/variants/${variantId}`, stranger).expect(404);
    await post(`/api/v1/inventory/variants/${variantId}/adjustments`, staff, { version: 1, delta: 5, commandKey: `staff-adjust-${randomUUID().slice(0, 8)}`, reason: 'staff cannot adjust' }).expect(403);
    const commandKey = `adjust-${randomUUID().slice(0, 8)}`;
    const adjusted = await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 5, commandKey, reason: 'initial stock receipt' }).expect(201);
    expect(adjusted.body.onHand).toBe(5);
    expect(adjusted.body.version).toBe(2);
    const replay = await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 5, commandKey, reason: 'initial stock receipt' }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    const conflict = await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 6, commandKey, reason: 'initial stock receipt' }).expect(409);
    expect(conflict.body.code).toBe('INVENTORY_IDEMPOTENCY_CONFLICT');
    const stale = await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 1, delta: 1, commandKey: `stale-${randomUUID().slice(0, 8)}`, reason: 'stale version adjustment' }).expect(409);
    expect(stale.body.code).toBe('INVENTORY_VERSION_CONFLICT');
    const negative = await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 2, delta: -6, commandKey: `negative-${randomUUID().slice(0, 8)}`, reason: 'would go negative' }).expect(409);
    expect(negative.body.code).toBe('INVENTORY_BOUNDS_INVALID');
    const movements = await get(`/api/v1/inventory/variants/${variantId}/movements`, staff).expect(200);
    expect(movements.body.items).toHaveLength(1);
    expect(movements.body.items[0].kind).toBe('ADJUST');
    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid`, [initialized.body.inventoryId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['inventory.initialized', 'inventory.adjusted']));
  });

  it('prevents concurrent oversell and supports idempotent reserve/release/consume', async () => {
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, productModerator, { version: 2, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, productModerator, { version: 3, reason: 'approved for public catalog' }).expect(201);
    const customerA = await makeUser('customer-a');
    const customerB = await makeUser('customer-b');
    const keyA = `reserve-a-${randomUUID().slice(0, 8)}`;
    const keyB = `reserve-b-${randomUUID().slice(0, 8)}`;
    const results = await Promise.allSettled([
      inventoryService.reserveStock({ userId: customerA.userId, variantId, quantity: 3, commandKey: keyA, ttlSeconds: 900 }),
      inventoryService.reserveStock({ userId: customerB.userId, variantId, quantity: 3, commandKey: keyB, ttlSeconds: 900 })
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.response?.code ?? rejected[0].reason?.message)).toContain('INSUFFICIENT_STOCK');
    const reservationId = fulfilled[0].value.reservationId;
    const reserveCustomer = results[0].status === 'fulfilled' ? customerA : customerB;
    const reserveKey = results[0].status === 'fulfilled' ? keyA : keyB;
    const balance = await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200);
    expect(balance.body.onHand).toBe(5);
    expect(balance.body.reserved).toBe(3);
    expect(balance.body.availableToPromise).toBe(2);
    const replay = await inventoryService.reserveStock({ userId: reserveCustomer.userId, variantId, quantity: 3, commandKey: reserveKey, ttlSeconds: 900 });
    expect(replay.duplicate).toBe(true);
    expect(replay.reservationId).toBe(reservationId);
    await expect(inventoryService.reserveStock({ userId: reserveCustomer.userId, variantId, quantity: 4, commandKey: reserveKey, ttlSeconds: 900 })).rejects.toMatchObject({ response: { code: 'RESERVATION_IDEMPOTENCY_CONFLICT' } });
    const released = await inventoryService.releaseReservation(reservationId, reserveCustomer.userId, 'customer cancelled checkout');
    expect(released.state).toBe('RELEASED');
    const releasedAgain = await inventoryService.releaseReservation(reservationId, reserveCustomer.userId, 'customer cancelled checkout');
    expect(releasedAgain.duplicate).toBe(true);
    const afterRelease = await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200);
    expect(afterRelease.body.reserved).toBe(0);
    expect(afterRelease.body.availableToPromise).toBe(5);
    const consumeKey = `reserve-consume-${randomUUID().slice(0, 8)}`;
    const consumedReservation = await inventoryService.reserveStock({ userId: customerB.userId, variantId, quantity: 2, commandKey: consumeKey, ttlSeconds: 900 });
    const consumed = await inventoryService.consumeReservation(consumedReservation.reservationId, null, 'order payment captured');
    expect(consumed.state).toBe('CONSUMED');
    await expect(inventoryService.releaseReservation(consumedReservation.reservationId, customerB.userId, 'late release attempt')).rejects.toMatchObject({ response: { code: 'RESERVATION_INVALID_TRANSITION' } });
    const afterConsume = await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200);
    expect(afterConsume.body.onHand).toBe(3);
    expect(afterConsume.body.reserved).toBe(0);
    const publicDetail = await request(app.getHttpServer()).get(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
    expect(publicDetail.body.variants[0].availableToPromise).toBe(3);
    expect(publicDetail.body.variants[0].inStock).toBe(true);
  });

  it('expires due reservations through the shared worker routine and releases stock exactly once', async () => {
    const customer = await makeUser('expiry-customer');
    const commandKey = `expire-${randomUUID().slice(0, 8)}`;
    const reservationId = randomUUID();
    const payloadHash = createHash('sha256').update(JSON.stringify({ reservationId, kind: 'RESERVE' })).digest('hex');
    await asSuper(u.privileged, async c => {
      const inv = (await c.query(`SELECT id, version, "onHand", reserved FROM "Inventory" WHERE "variantId"=$1 FOR UPDATE`, [variantId])).rows[0];
      await c.query(`INSERT INTO "InventoryReservation"(id,"inventoryId","userId","commandKey","payloadHash",quantity,state,"expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,1,'ACTIVE',now()-interval '1 second',now()-interval '61 seconds',now()-interval '61 seconds')`, [reservationId, inv.id, customer.userId, commandKey, createHash('sha256').update(commandKey).digest('hex')]);
      const updated = (await c.query(`UPDATE "Inventory" SET reserved=reserved+1, version=version+1, "updatedAt"=now() WHERE id=$1 RETURNING version, "onHand", reserved`, [inv.id])).rows[0];
      await c.query(`INSERT INTO "InventoryMovement"(id,"inventoryId","inventoryVersion",kind,"commandKey","payloadHash","reservationId","onHandDelta","reservedDelta","onHandAfter","reservedAfter",reason,"actorUserId") VALUES (gen_random_uuid(),$1,$2,'RESERVE',$3,$4,$5,0,1,$6,$7,'checkout stock reservation',$8)`, [inv.id, updated.version, `reserve:${reservationId}`, payloadHash, reservationId, updated.onHand, updated.reserved, customer.userId]);
    });
    const log = { info: () => undefined, error: () => undefined } as any;
    const expired = await runInventoryExpiryTick(privilegedPool, log, 100);
    expect(expired).toBeGreaterThanOrEqual(1);
    const again = await runInventoryExpiryTick(privilegedPool, log, 100);
    expect(again).toBe(0);
    const state = await asSuper(u.privileged, async c => (await c.query(`SELECT state, version FROM "InventoryReservation" WHERE id=$1`, [reservationId])).rows[0]);
    expect(state.state).toBe('EXPIRED');
    expect(state.version).toBe(2);
    const balance = await get(`/api/v1/inventory/variants/${variantId}`, owner).expect(200);
    expect(balance.body.reserved).toBe(0);
    expect(balance.body.onHand).toBe(3);
    await expect(inventoryService.consumeReservation(reservationId, null, 'late consume attempt')).rejects.toMatchObject({ response: { code: 'RESERVATION_INVALID_TRANSITION' } });
  });

  it('enforces database append-only movements, deferred balance invariants and runtime write denial', async () => {
    const inventory = await asSuper(u.privileged, async c => (await c.query(`SELECT id, version, reserved FROM "Inventory" WHERE "variantId"=$1`, [variantId])).rows[0]);
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "Inventory" SET "onHand"="onHand"+1, version=version+1 WHERE id=$1`, [inventory.id]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Inventory" SET "onHand"="onHand"+1, version=version+1 WHERE id=$1`, [inventory.id]))).rejects.toThrow(/inventory_movement_required/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Inventory" SET reserved=reserved+1, version=version+1 WHERE id=$1`, [inventory.id]))).rejects.toThrow(/inventory_reserved_mismatch|inventory_movement_required/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "InventoryMovement" SET reason='tampered movement' WHERE "inventoryId"=$1`, [inventory.id]))).rejects.toThrow(/permission denied|append_only/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "InventoryMovement" WHERE "inventoryId"=$1`, [inventory.id]))).rejects.toThrow(/permission denied|append_only/);
    const customer = await makeUser('guard-customer');
    await expect(inventoryService.reserveStock({ userId: customer.userId, variantId, quantity: 0, commandKey: `bad-qty-${randomUUID().slice(0, 8)}` })).rejects.toMatchObject({ response: { code: 'RESERVATION_QUANTITY_INVALID' } });
    await expect(inventoryService.reserveStock({ userId: customer.userId, variantId, quantity: 1, commandKey: `bad-ttl-${randomUUID().slice(0, 8)}`, ttlSeconds: 59 })).rejects.toMatchObject({ response: { code: 'RESERVATION_TTL_INVALID' } });
  });

  it('fails closed for stock writes and reservations after vendor KYC revocation', async () => {
    await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 4, commandKey: `revoke-${kycCaseId}`, decision: 'REVOKE', reason: 'policy violation found' }).expect(201);
    const customer = await makeUser('revoked-customer');
    await post(`/api/v1/inventory/variants/${variantId}/adjustments`, owner, { version: 99, delta: 1, commandKey: `revoked-adjust-${randomUUID().slice(0, 8)}`, reason: 'adjust after KYC revoke' }).expect(403);
    await expect(inventoryService.reserveStock({ userId: customer.userId, variantId, quantity: 1, commandKey: `revoked-reserve-${randomUUID().slice(0, 8)}` })).rejects.toMatchObject({ response: { code: 'RESERVATION_NOT_SELLABLE' } });
    const publicDetail = await request(app.getHttpServer()).get(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(404);
    expect(publicDetail.body.code).toBe('PRODUCT_NOT_FOUND');
  });
});
