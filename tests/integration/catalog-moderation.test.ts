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
let otherCityId: string;
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-catalog-moderation-test-${randomUUID()}`;

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `catalog-moderation-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Catalog Moderation ${label}`]);
    await c.query(`INSERT INTO "Session"(id,"userId","tokenHash","expiresAt","idleExpiresAt","authVersion") VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '15 minutes',1)`, [sessionId, userId, tokenHash]);
  });
  const me = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `gs_session_dev=${token}`).expect(200);
  return { userId, sessionId, token, csrf: me.body.csrfToken as string };
}
function post(path: string, user: { token: string; csrf: string }, body: unknown = {}) {
  return request(app.getHttpServer()).post(path).set('Cookie', `gs_session_dev=${user.token}`).set('Origin', origin).set('X-CSRF-Token', user.csrf).send(body);
}
function get(path: string, user: { token: string }) { return request(app.getHttpServer()).get(path).set('Cookie', `gs_session_dev=${user.token}`); }
function publicGet(path: string) { return request(app.getHttpServer()).get(path); }
async function setStepUp(user: { sessionId: string }) {
  await asSuper(u.privileged, async c => { await c.query(`UPDATE "Session" SET "assuranceLevel"='STEP_UP', "stepUpExpiresAt"=now()+interval '10 minutes' WHERE id=$1`, [user.sessionId]); });
}
async function grantKeys(user: { userId: string; sessionId: string }, scopeCountryId: string, keys: string[], opts: { stepUp?: boolean; scope?: boolean } = {}) {
  const { stepUp = true, scope = true } = opts;
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `catalog-moderation-role-${randomUUID()}`, 'Catalog Moderation Role']);
    for (const key of keys) {
      const [resource] = key.split(':');
      const perm = await c.query(`INSERT INTO "Permission"(id,key,resource,action,sensitivity) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO UPDATE SET resource=EXCLUDED.resource RETURNING id`, [randomUUID(), key, resource, key.slice(resource.length + 1), 'high']);
      await c.query(`INSERT INTO "RolePermission"("roleId","permissionId") VALUES ($1,$2)`, [role.rows[0].id, perm.rows[0].id]);
    }
    await c.query(`INSERT INTO "UserRole"(id,"userId","roleId","grantedBy") VALUES ($1,$2,$3,$4)`, [randomUUID(), user.userId, role.rows[0].id, user.userId]);
    if (scope) await c.query(`INSERT INTO "AdminScope"(id,"userId","geographyType","countryId","grantedBy") VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), user.userId, 'COUNTRY', scopeCountryId, user.userId]);
  });
  if (stepUp) await setStepUp(user);
}
async function makeStorageObject(ownerId: string) {
  const id = randomUUID(); const hash = createHash('sha256').update(`catalog-moderation-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return { id, hash };
}
async function createApprovedKyc(subject: { userId: string; token: string; csrf: string }) {
  const reviewer = await makeUser('kyc-reviewer');
  await grantKeys(reviewer, countryId, ['kyc:case:review']);
  const created = await post('/api/v1/kyc/cases', subject, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const caseId = created.body.caseId as string;
  const doc = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${caseId}/documents`, subject, { storageObjectId: doc.id, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${caseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: `start-${caseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: `approve-${caseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  return { caseId, reviewer };
}
async function createActiveVendor(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const created = await post('/api/v1/parties/vendors', owner, { countryId, displayName: `Moderation Vendor ${label}` }).expect(201);
  const vendorId = created.body.vendorId as string;
  const { caseId: kycCaseId, reviewer: kycReviewer } = await createApprovedKyc(owner);
  const admin = await makeUser(`${label}-party-admin`);
  await grantKeys(admin, countryId, ['vendor:profile:activate', 'vendor:profile:suspend']);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, admin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  return { owner, vendorId, admin, kycCaseId, kycReviewer };
}
async function createCity(label: string) {
  return asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `mod-reg-${label}-${randomUUID().slice(0, 8)}`, label, 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `mod-dist-${label}-${randomUUID().slice(0, 8)}`, label, 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `mod-city-${label}-${randomUUID().slice(0, 8)}`, label, 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
}
async function createActiveStore(label: string, targetCityId = cityId) {
  const { owner, vendorId, kycCaseId, kycReviewer } = await createActiveVendor(label);
  const created = await post('/api/v1/catalog/stores', owner, { vendorId, cityId: targetCityId, name: `Moderation Store ${label}`, slug: `moderation-store-${label}-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  const storeId = created.body.storeId as string;
  const admin = await makeUser(`${label}-store-admin`);
  await grantKeys(admin, countryId, ['catalog:store:activate', 'catalog:store:suspend']);
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, admin, { version: 1, reason: 'store evidence verified' }).expect(201);
  return { owner, vendorId, storeId, storeAdmin: admin, kycCaseId, kycReviewer };
}
async function createDraftProduct(owner: { token: string; csrf: string }, storeId: string, title: string, withVariant = true) {
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title, description: 'A moderated product description long enough', brand: 'Stoopy' }).expect(201);
  const productId = product.body.productId as string;
  if (withVariant) await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `SKU-${randomUUID().slice(0, 8)}`, optionValues: { size: 'M' }, priceAmountMinor: '125000', compareAtAmountMinor: '150000', currency: 'BDT', weightGrams: 250 }).expect(201);
  return productId;
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
  cityId = await createCity('primary');
  otherCityId = await createCity('other');
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

describe('product moderation/publication gate and public catalog reads', () => {
  it('runs submit → independent review → independent publish → public read → unpublish with authorization gates', async () => {
    const { owner, storeId } = await createActiveStore('lifecycle');
    const runId = randomUUID().slice(0, 8);
    const productId = await createDraftProduct(owner, storeId, `Lifecycle Smart Lamp ${runId}`);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(404);
    const before = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&q=${runId}`).expect(200);
    expect(before.body.items).toEqual([]);

    const noPerm = await makeUser('review-no-perm');
    await post(`/api/v1/catalog/admin/products/${productId}/review`, noPerm, { version: 1, decision: 'APPROVE', reason: 'attempted review' }).expect(403);
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
    const noStep = await makeUser('review-no-step'); await grantKeys(noStep, countryId, ['catalog:product:review'], { stepUp: false });
    const stepDenied = await post(`/api/v1/catalog/admin/products/${productId}/review`, noStep, { version: 2, decision: 'APPROVE', reason: 'attempted review' }).expect(403);
    expect(stepDenied.body.code).toBe('STEP_UP_REQUIRED');
    const cross = await makeUser('review-cross');
    const otherCountry = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'LK', 'Sri Lanka', 'LKR', '+94', 'Asia/Colombo', 'ACTIVE'])).rows[0].id as string);
    await grantKeys(cross, otherCountry, ['catalog:product:review', 'catalog:product:publish']);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, cross, { version: 2, decision: 'APPROVE', reason: 'attempted review' }).expect(404);
    await grantKeys(owner, countryId, ['catalog:product:review', 'catalog:product:publish']);
    const selfReview = await post(`/api/v1/catalog/admin/products/${productId}/review`, owner, { version: 2, decision: 'APPROVE', reason: 'self review attempt' }).expect(403);
    expect(selfReview.body.code).toBe('SELF_REVIEW_DENIED');

    const moderator = await makeUser('moderator'); await grantKeys(moderator, countryId, ['catalog:product:review', 'catalog:product:publish']);
    const queueBefore = await get(`/api/v1/catalog/admin/products?countryId=${countryId}&moderationState=PENDING_REVIEW`, moderator).expect(200);
    expect(queueBefore.body.items.some((p: any) => p.id === productId)).toBe(true);
    const approved = await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'content and evidence verified' }).expect(201);
    expect(approved.body.moderationState).toBe('APPROVED');
    expect(approved.body.status).toBe('DRAFT');
    const selfPublish = await post(`/api/v1/catalog/admin/products/${productId}/publish`, owner, { version: 3, reason: 'self publish attempt' }).expect(403);
    expect(selfPublish.body.code).toBe('SELF_PUBLICATION_DENIED');
    const published = await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 3, reason: 'approved for public catalog' }).expect(201);
    expect(published.body.status).toBe('PUBLISHED');

    const detail = await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
    expect(detail.body.title).toBe(`Lifecycle Smart Lamp ${runId}`);
    expect(detail.body.variants).toHaveLength(1);
    expect(detail.body.variants[0].priceAmountMinor).toBe('125000');
    const listed = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&cityId=${cityId}&q=${runId}&limit=10`).expect(200);
    expect(listed.body.items.some((p: any) => p.id === productId)).toBe(true);
    const uppercase = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId.toUpperCase()}&cityId=${cityId.toUpperCase()}&q=${runId}`).expect(200);
    expect(uppercase.body.items.some((p: any) => p.id === productId)).toBe(true);
    expect((await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&q=a&q=b`).expect(400)).body.code).toBe('QUERY_INVALID');
    expect((await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&q=a%00b`).expect(400)).body.code).toBe('QUERY_INVALID');
    const wrongCity = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&cityId=${otherCityId}&q=${runId}`).expect(200);
    expect(wrongCity.body.items).toEqual([]);
    await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: 'LOCKED-SKU', optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(409);

    const unpublished = await post(`/api/v1/catalog/admin/products/${productId}/unpublish`, moderator, { version: 4, reason: 'temporary catalog removal' }).expect(201);
    expect(unpublished.body.status).toBe('DRAFT');
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(404);
    const audits = await asSuper(u.privileged, async c => c.query(`SELECT action FROM "AuditLog" WHERE "resourceId"=$1::uuid`, [productId]));
    expect(audits.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['catalog.product.submitted', 'catalog.product.approve', 'catalog.product.published', 'catalog.product.unpublished']));
    const events = await asSuper(u.privileged, async c => c.query(`SELECT "eventType" FROM "OutboxEvent" WHERE "aggregateId"=$1`, [productId]));
    expect(events.rows.map((r: any) => r.eventType)).toEqual(expect.arrayContaining(['catalog.product.submitted', 'catalog.product.reviewed', 'catalog.product.published', 'catalog.product.unpublished']));
  });

  it('supports rejection/resubmission, version conflicts and requires an active variant before submission', async () => {
    const { owner, storeId } = await createActiveStore('rejection');
    const emptyProduct = await createDraftProduct(owner, storeId, 'Empty Product', false);
    const noVariant = await post(`/api/v1/catalog/products/${emptyProduct}/submit`, owner, { version: 1 }).expect(409);
    expect(noVariant.body.code).toBe('PRODUCT_ACTIVE_VARIANT_REQUIRED');
    await post(`/api/v1/catalog/products/${emptyProduct}/variants`, owner, { sku: 'EMPTY-SKU', optionValues: {}, priceAmountMinor: '1000', currency: 'BDT' }).expect(201);
    const productId = await createDraftProduct(owner, storeId, 'Rejectable Product');
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
    const moderator = await makeUser('reject-moderator'); await grantKeys(moderator, countryId, ['catalog:product:review', 'catalog:product:publish']);
    const stale = await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 1, decision: 'REJECT', reason: 'stale version attempt' }).expect(409);
    expect(stale.body.code).toBe('PRODUCT_VERSION_CONFLICT');
    const rejected = await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 2, decision: 'REJECT', reason: 'description needs correction' }).expect(201);
    expect(rejected.body.moderationState).toBe('REJECTED');
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 3, reason: 'publish rejected product' }).expect(409);
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 3 }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 4, decision: 'APPROVE', reason: 'corrected content verified' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 5, reason: 'approved after resubmission' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
  });

  it('enforces database moderation/publication guards and runtime write denial', async () => {
    const { owner, storeId } = await createActiveStore('guards');
    const productId = await createDraftProduct(owner, storeId, 'Guarded Product');
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "Product" SET "moderationState"='APPROVED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET "moderationState"='APPROVED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/product_moderation_invalid_transition/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET status='PUBLISHED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/product_moderation_approved_required/);
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET "moderationState"='APPROVED', "reviewedAt"=now(), "reviewedByUserId"=$2, "moderationReason"='self approval attempt', version=3 WHERE id=$1`, [productId, owner.userId]))).rejects.toThrow(/product_self_review_denied/);
    const moderator = await makeUser('guard-moderator'); await grantKeys(moderator, countryId, ['catalog:product:review', 'catalog:product:publish']);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'guard review approved' }).expect(201);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET status='PUBLISHED', "publishedAt"=now(), "publishedByUserId"=$2, version=4 WHERE id=$1`, [productId, owner.userId]))).rejects.toThrow(/product_self_publication_denied/);
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 3, reason: 'guard publication approved' }).expect(201);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "ProductVariant" SET "priceAmountMinor"=999, version=2 WHERE "productId"=$1`, [productId]))).rejects.toThrow(/variant_product_published_locked/);
  });

  it('fails closed for public reads when store is suspended or vendor KYC is revoked', async () => {
    const { owner, storeId, storeAdmin, kycCaseId, kycReviewer } = await createActiveStore('fail-closed');
    const runId = randomUUID().slice(0, 8);
    const productId = await createDraftProduct(owner, storeId, `Fail Closed Product ${runId}`);
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
    const moderator = await makeUser('fail-closed-moderator'); await grantKeys(moderator, countryId, ['catalog:product:review', 'catalog:product:publish']);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, moderator, { version: 2, decision: 'APPROVE', reason: 'fail closed review approved' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, moderator, { version: 3, reason: 'fail closed publication approved' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
    await post(`/api/v1/catalog/admin/stores/${storeId}/suspend`, storeAdmin, { version: 2, reason: 'store policy investigation' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(404);
    const suspendedList = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&q=${runId}`).expect(200);
    expect(suspendedList.body.items).toEqual([]);
    await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 3, reason: 'store investigation resolved' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
    await post(`/api/v1/kyc/admin/cases/${kycCaseId}/decision`, kycReviewer, { version: 4, commandKey: `revoke-${kycCaseId}`, decision: 'REVOKE', reason: 'policy violation found' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(404);
    const revokedList = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&q=${runId}`).expect(200);
    expect(revokedList.body.items).toEqual([]);
  });
});
