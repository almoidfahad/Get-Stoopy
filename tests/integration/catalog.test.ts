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
let bdCityId: string;
let lkCityId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-catalog-test-${randomUUID()}`;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `catalog-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Catalog ${label}`]);
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
async function grantKeys(user: { userId: string; sessionId: string }, countryId: string, keys: string[], opts: { stepUp?: boolean; scope?: boolean } = {}) {
  const { stepUp = true, scope = true } = opts;
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `catalog-role-${randomUUID()}`, 'Catalog Role']);
    for (const key of keys) {
      const [resource] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    if (scope) await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', countryId, user.userId]);
  });
  if (stepUp) await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`catalog-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return { id, hash };
}
async function createApprovedKyc(subject: { userId: string; token: string; csrf: string }, countryId: string) {
  const reviewer = await makeUser('kyc-reviewer');
  await grantKeys(reviewer, countryId, ['kyc:case:review']);
  const created = await post('/api/v1/kyc/cases', subject, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const caseId = created.body.caseId as string;
  const doc = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${caseId}/documents`, subject, { storageObjectId: doc.id, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${caseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: `start-${caseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: `approve-${caseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  return caseId;
}
async function createActiveVendor(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const created = await post('/api/v1/parties/vendors', owner, { countryId: bdCountryId, displayName: `Catalog Vendor ${label}` }).expect(201);
  const vendorId = created.body.vendorId as string;
  const kycCaseId = await createApprovedKyc(owner, bdCountryId);
  const admin = await makeUser(`${label}-party-admin`);
  await grantKeys(admin, bdCountryId, ['vendor:profile:activate', 'vendor:profile:suspend']);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  return { owner, vendorId, admin, kycCaseId };
}
async function createContext(countryId: string, label: string) {
  return asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `reg-${label}-${randomUUID().slice(0, 8)}`, label, 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `dist-${label}-${randomUUID().slice(0, 8)}`, label, 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `city-${label}-${randomUUID().slice(0, 8)}`, label, 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
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
  bdCityId = await createContext(bdCountryId, 'BD');
  lkCityId = await createContext(lkCountryId, 'LK');
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

describe('draft catalog foundation with vendor eligibility gates', () => {
  it('creates store drafts idempotently and enforces membership, slug and city-country rules', async () => {
    const { owner, vendorId } = await createActiveVendor('store');
    const created = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'Stoopy Store', slug: 'stoopy-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const storeId = created.body.storeId as string;
    expect(created.body.status).toBe('DRAFT');
    const duplicate = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'Stoopy Store', slug: 'stoopy-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    expect(duplicate.body.storeId).toBe(storeId); expect(duplicate.body.duplicate).toBe(true);
    await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'Different', slug: 'stoopy-store', addressLine: '456 Other Road, Mymensingh' }).expect(409);
    await post('/api/v1/catalog/stores', owner, { vendorId, cityId: lkCityId, name: 'Cross Border', slug: 'cross-border', addressLine: '789 Foreign Road, Colombo' }).expect(400);
    const stranger = await makeUser('store-stranger');
    await post('/api/v1/catalog/stores', stranger, { vendorId, cityId: bdCityId, name: 'Foreign Store', slug: 'foreign-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(403);
    const list = await get(`/api/v1/catalog/stores?vendorId=${vendorId}`, owner).expect(200);
    expect(list.body.some((s: any) => s.id === storeId)).toBe(true);
    await get(`/api/v1/catalog/stores?vendorId=${vendorId}`, stranger).expect(404);
  });

  it('gates store activation and product drafts on privileged non-self activation plus active KYC-eligible vendor/store', async () => {
    const { owner, vendorId } = await createActiveVendor('activation');
    const created = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'Activation Store', slug: 'activation-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const storeId = created.body.storeId as string;
    await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Draft Product', description: 'A draft product description long enough' }).expect(409);
    const noPerm = await makeUser('store-no-perm');
    await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, noPerm, { version: 1, reason: 'attempt activation' }).expect(403);
    const noStep = await makeUser('store-no-step'); await grantKeys(noStep, bdCountryId, ['catalog:store:activate'], { stepUp: false });
    const stepDenied = await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, noStep, { version: 1, reason: 'attempt activation' }).expect(403);
    expect(stepDenied.body.code).toBe('STEP_UP_REQUIRED');
    const cross = await makeUser('store-cross'); await grantKeys(cross, lkCountryId, ['catalog:store:activate']);
    await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, cross, { version: 1, reason: 'attempt activation' }).expect(404);
    await grantKeys(owner, bdCountryId, ['catalog:store:activate']);
    const self = await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, owner, { version: 1, reason: 'self activation attempt' }).expect(403);
    expect(self.body.code).toBe('SELF_ACTIVATION_DENIED');
    const admin = await makeUser('store-admin'); await grantKeys(admin, bdCountryId, ['catalog:store:activate', 'catalog:store:suspend']);
    const activated = await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, admin, { version: 1, reason: 'store evidence verified' }).expect(201);
    expect(activated.body.status).toBe('ACTIVE');
    const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Draft Product', description: 'A draft product description long enough', brand: 'Stoopy' }).expect(201);
    expect(product.body.status).toBe('DRAFT');
    const productId = product.body.productId as string;
    const variant = await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'SKU-1', optionValues: { size: 'M' }, priceAmountMinor: '125000', compareAtAmountMinor: '150000', currency: 'BDT', weightGrams: 250 }).expect(201);
    expect(variant.body.priceAmountMinor).toBe('125000');
    await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'SKU-2', optionValues: {}, priceAmountMinor: '1000', currency: 'USD' }).expect(400);
    await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'SKU-1', optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(409);
    const variants = await get(`/api/v1/catalog/products/${productId}/variants`, owner).expect(200);
    expect(variants.body).toHaveLength(1);
    const archived = await post(`/api/v1/catalog/products/${productId}/archive`, owner, { version: 1 }).expect(201);
    expect(archived.body.status).toBe('ARCHIVED');
    await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'SKU-3', optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(409);
    await post(`/api/v1/catalog/admin/stores/${storeId}/suspend`, admin, { version: 2, reason: 'store policy investigation' }).expect(201);
    await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Blocked Product', description: 'A draft product description long enough' }).expect(409);
    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid`, [storeId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['catalog.store.created', 'catalog.store.activated', 'catalog.store.suspended']));
    const events = await asSuper(u.privileged, async c => c.query(`SELECT "eventType" FROM "OutboxEvent" WHERE "aggregateId"=$1`, [productId]));
    expect(events.rows.map((r: any) => r.eventType)).toEqual(expect.arrayContaining(['catalog.product.created', 'catalog.variant.created', 'catalog.product.archived']));
  });

  it('enforces runtime RLS isolation and database publication/write guards', async () => {
    const { owner, vendorId } = await createActiveVendor('rls');
    const created = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'RLS Store', slug: 'rls-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const storeId = created.body.storeId as string;
    const admin = await makeUser('rls-store-admin'); await grantKeys(admin, bdCountryId, ['catalog:store:activate']);
    await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, admin, { version: 1, reason: 'store evidence verified' }).expect(201);
    const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'RLS Product', description: 'A draft product description long enough' }).expect(201);
    const productId = product.body.productId as string;
    await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'RLS-SKU', optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
    const stranger = await makeUser('rls-stranger');
    const ownStore = await asUser(u.runtime, owner.userId, c => c.query(`SELECT id FROM "Store" WHERE id=$1`, [storeId]));
    expect(ownStore.rowCount).toBe(1);
    const foreignStore = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "Store" WHERE id=$1`, [storeId]));
    expect(foreignStore.rowCount).toBe(0);
    const foreignProduct = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT id FROM "Product" WHERE id=$1`, [productId]));
    expect(foreignProduct.rowCount).toBe(0);
    const foreignVariant = await asUser(u.runtime, stranger.userId, c => c.query(`SELECT v.id FROM "ProductVariant" v WHERE v."productId"=$1`, [productId]));
    expect(foreignVariant.rowCount).toBe(0);
    await get(`/api/v1/catalog/stores/${storeId}/products`, stranger).expect(404);
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "Product" SET status='PUBLISHED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET status='PUBLISHED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/product_publication_not_enabled/);
    await expect(asSuper(u.privileged, c => c.query(`DELETE FROM "Store" WHERE id=$1`, [storeId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`INSERT INTO "ProductVariant"(id,"productId",sku,"optionValues","priceAmountMinor",currency,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`, [randomUUID(), productId, 'BAD-CURRENCY', '{}', 1000, 'USD']))).rejects.toThrow(/variant_currency_mismatch/);
  });

  it('fails closed for catalog writes when vendor KYC is revoked or membership is revoked', async () => {
    const { owner, vendorId, kycCaseId } = await createActiveVendor('revocation');
    const created = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: bdCityId, name: 'Revocation Store', slug: 'revocation-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const storeId = created.body.storeId as string;
    const admin = await makeUser('revocation-store-admin'); await grantKeys(admin, bdCountryId, ['catalog:store:activate']);
    await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, admin, { version: 1, reason: 'store evidence verified' }).expect(201);
    await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'Before Revoke', description: 'A draft product description long enough' }).expect(201);
    const reviewer = await makeUser('revocation-reviewer'); await grantKeys(reviewer, bdCountryId, ['kyc:case:review']);
    await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, reviewer, { version: 4, commandKey: `revoke-${kycCaseId}`, decision: 'REVOKE', reason: 'policy violation found' }).expect(201);
    expect((await get('/api/v1/auth/me', owner).expect(200)).body.vendorMemberships).toEqual([]);
    await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title: 'After Revoke', description: 'A draft product description long enough' }).expect(403);
    const { owner: owner2, vendorId: vendorId2 } = await createActiveVendor('membership');
    const store2 = await post('/api/v1/catalog/stores', owner2, { vendorId: vendorId2, cityId: bdCityId, name: 'Membership Store', slug: 'membership-store', addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
    const storeId2 = store2.body.storeId as string;
    const admin2 = await makeUser('membership-store-admin'); await grantKeys(admin2, bdCountryId, ['catalog:store:activate']);
    await post(`/api/v1/catalog/admin/stores/${storeId2}/activate`, admin2, { version: 1, reason: 'store evidence verified' }).expect(201);
    const staff = await makeUser('catalog-staff'); await setStepUp(owner2);
    const granted = await post(`/api/v1/parties/vendors/${vendorId2}/memberships`, owner2, { userId: staff.userId, role: 'MANAGER' }).expect(201);
    await post(`/api/v1/catalog/stores/${storeId2}/products`, staff, { title: 'Staff Product', description: 'A draft product description long enough' }).expect(201);
    await post(`/api/v1/parties/vendors/${vendorId2}/memberships/${granted.body.membershipId}/revoke`, owner2).expect(201);
    await post(`/api/v1/catalog/stores/${storeId2}/products`, staff, { title: 'Blocked Staff Product', description: 'A draft product description long enough' }).expect(403);
  });
});
