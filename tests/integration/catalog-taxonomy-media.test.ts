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
let pool: pg.Pool;
let queue: Queue;
let redis: Redis;
const queueName = `gs-catalog-taxonomy-media-${randomUUID()}`;
let owner: any;
let vendorId: string;
let storeId: string;
let storeAdmin: any;
let taxonomyCreator: any;
let taxonomyActivator: any;
let mediaReviewer: any;
let productModerator: any;
let rootCategoryId: string;
let childCategoryId: string;
let publishedProductId: string;
let publishedImageId: string;
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

async function makeUser(label: string) {
  const userId = randomUUID(); const token = `catalog-taxonomy-media-${label}-${randomUUID()}`; const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [userId, `Taxonomy Media ${label}`]);
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
async function grantKeys(user: { userId: string; sessionId: string }, keys: string[], opts: { stepUp?: boolean; scope?: boolean } = {}) {
  const { stepUp = true, scope = true } = opts;
  await asSuper(u.privileged, async c => {
    const role = await c.query(`INSERT INTO "Role"(id,key,name) VALUES ($1,$2,$3) RETURNING id`, [randomUUID(), `taxonomy-media-role-${randomUUID()}`, 'Taxonomy Media Role']);
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
  const id = randomUUID(); const hash = createHash('sha256').update(`taxonomy-media-evidence-${id}`).digest('hex');
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "StorageObject"(id,"ownerUserId",purpose,"objectKey","contentType","sizeBytes",sha256,state,"magicValid","encryptionKeyId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`, [id, ownerId, 'kyc-document', `kyc-document/${ownerId}/${id}`, 'application/pdf', 100, hash, 'UPLOADED', true, 'local-dev-aes-256-gcm']);
  });
  return id;
}
async function createApprovedKyc(subject: { userId: string; token: string; csrf: string }) {
  const reviewer = await makeUser('kyc-reviewer');
  await grantKeys(reviewer, ['kyc:case:review']);
  const created = await post('/api/v1/kyc/cases', subject, { subjectType: 'VENDOR', countryId, policyVersion: 'kyc-v1', consentVersion: 'consent-v1', consent: true }).expect(201);
  const caseId = created.body.caseId as string;
  const docId = await makeStorageObject(subject.userId);
  await post(`/api/v1/kyc/cases/${caseId}/documents`, subject, { storageObjectId: docId, documentType: 'TRADE_LICENSE' }).expect(201);
  await post(`/api/v1/kyc/cases/${caseId}/submit`, subject, { version: 1 }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 2, commandKey: `start-${caseId}`, decision: 'START_REVIEW', reason: 'begin manual review' }).expect(201);
  await post(`/api/v1/kyc/admin/cases/${caseId}/decision`, reviewer, { version: 3, commandKey: `approve-${caseId}`, decision: 'APPROVE', reason: 'evidence matches policy', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString() }).expect(201);
  return caseId;
}
async function drainOutbox() {
  for (let i = 0; i < 25; i++) {
    const pending = await pool.query(`UPDATE "OutboxEvent" SET "availableAt"=now(), "leaseToken"=NULL, "leaseUntil"=NULL WHERE "publishedAt" IS NULL AND "failedAt" IS NULL RETURNING id`);
    if ((pending.rowCount ?? 0) === 0) return;
    await publishOutboxBatch(pool, queue, { maxAttempts: 1, batchSize: 100, queueName });
  }
}
async function uploadProductImage(user: any) {
  const create = await post('/api/v1/storage/uploads', user, { purpose: 'product-image', contentType: 'image/png', sizeBytes: png.length }).expect(201);
  expect(create.body.maxBytes).toBe(5 * 1024 * 1024);
  const up = await request(app.getHttpServer()).put(`/api/v1/storage/uploads/${create.body.objectId}`).set('Cookie', `gs_session_dev=${user.token}`).set('X-Storage-Token', create.body.token).set('Content-Type', 'image/png').send(png).expect(200);
  expect(up.body.state).toBe('QUARANTINED');
  return create.body.objectId as string;
}
async function createDraftProduct(title: string) {
  const product = await post(`/api/v1/catalog/stores/${storeId}/products`, owner, { title, description: 'A taxonomy media product description long enough', brand: 'Stoopy' }).expect(201);
  const productId = product.body.productId as string;
  await post(`/api/v1/catalog/products/${productId}/variants`, owner, { sku: `SKU-${randomUUID().slice(0, 8)}`, optionValues: {}, priceAmountMinor: '125000', currency: 'BDT' }).expect(201);
  return productId;
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['WEB_ORIGIN'] = origin; process.env['DATABASE_URL'] = u.runtime; process.env['DATABASE_PRIVILEGED_URL'] = u.privileged;
  process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15'; process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8080/realms/get-stoopy'; process.env['KEYCLOAK_CLIENT_ID'] = 'get-stoopy-web'; process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
  process.env['BFF_API_SHARED_SECRET'] = 'test-bff-secret-000000000000000000000000'; process.env['SESSION_TOKEN_ENCRYPTION_KEY'] = 'c'.repeat(64); process.env['SESSION_COOKIE_NAME'] = 'gs_session_dev';
  process.env['STORAGE_ENCRYPTION_KEY'] = 'e'.repeat(64); process.env['STORAGE_LOCAL_DIR'] = `.local/test-storage-${randomUUID()}`;
  const { createApp } = await import('../../apps/api/src/main'); app = await createApp(); await app.init();
  countryId = await asSuper(u.privileged, async c => (await c.query(`INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID(), 'BD', 'Bangladesh', 'BDT', '+880', 'Asia/Dhaka', 'ACTIVE'])).rows[0].id as string);
  cityId = await asSuper(u.privileged, async c => {
    const region = await c.query(`INSERT INTO "Region"(id,"countryId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), countryId, `tax-reg-${randomUUID().slice(0, 8)}`, 'Taxonomy', 'ACTIVE']);
    const district = await c.query(`INSERT INTO "District"(id,"regionId",code,name,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [randomUUID(), region.rows[0].id, `tax-dist-${randomUUID().slice(0, 8)}`, 'Taxonomy', 'ACTIVE']);
    const city = await c.query(`INSERT INTO "City"(id,"districtId",code,name,kind,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [randomUUID(), district.rows[0].id, `tax-city-${randomUUID().slice(0, 8)}`, 'Taxonomy', 'CITY', 'ACTIVE']);
    return city.rows[0].id as string;
  });
  pool = new pg.Pool({ connectionString: u.runtime, max: 4 });
  const parsed = new URL(process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6379/15');
  redis = new Redis({ host: parsed.hostname, port: Number(parsed.port || 6379), db: Number(parsed.pathname.slice(1) || 0), maxRetriesPerRequest: null });
  queue = new Queue(queueName, { connection: redis });
  await drainOutbox();

  owner = await makeUser('owner');
  const vendor = await post('/api/v1/parties/vendors', owner, { countryId, displayName: 'Taxonomy Media Vendor' }).expect(201);
  vendorId = vendor.body.vendorId;
  const kycCaseId = await createApprovedKyc(owner);
  const partyAdmin = await makeUser('party-admin'); await grantKeys(partyAdmin, ['vendor:profile:activate']);
  await post(`/api/v1/parties/admin/vendors/${vendorId}/activate`, partyAdmin, { version: 1, kycCaseId, reason: 'approved vendor evidence' }).expect(201);
  const store = await post('/api/v1/catalog/stores', owner, { vendorId, cityId, name: 'Taxonomy Media Store', slug: `taxonomy-media-store-${randomUUID().slice(0, 8)}`, addressLine: '123 Pilot Road, Mymensingh' }).expect(201);
  storeId = store.body.storeId;
  storeAdmin = await makeUser('store-admin'); await grantKeys(storeAdmin, ['catalog:store:activate', 'catalog:store:suspend']);
  await post(`/api/v1/catalog/admin/stores/${storeId}/activate`, storeAdmin, { version: 1, reason: 'store evidence verified' }).expect(201);
  taxonomyCreator = await makeUser('taxonomy-creator'); await grantKeys(taxonomyCreator, ['catalog:category:manage']);
  taxonomyActivator = await makeUser('taxonomy-activator'); await grantKeys(taxonomyActivator, ['catalog:category:manage']);
  mediaReviewer = await makeUser('media-reviewer'); await grantKeys(mediaReviewer, ['catalog:product-image:review']);
  productModerator = await makeUser('product-moderator'); await grantKeys(productModerator, ['catalog:product:review', 'catalog:product:publish']);
});
afterAll(async () => {
  await drainOutbox();
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (redis) await redis.quit();
  if (pool) await pool.end();
  if (app) await app.close();
});

describe('category taxonomy and product image foundation', () => {
  it('creates a bounded country-scoped taxonomy with privileged non-self activation and public active-chain reads', async () => {
    const suffix = randomUUID().slice(0, 8);
    const root = await post('/api/v1/catalog/admin/categories', taxonomyCreator, { countryId, name: `Home ${suffix}`, slug: `home-${suffix}`, sortOrder: 1 }).expect(201);
    rootCategoryId = root.body.id;
    expect(root.body.status).toBe('DRAFT');
    const publicBefore = await publicGet(`/api/v1/public/catalog/categories?countryId=${countryId}`).expect(200);
    expect(publicBefore.body.some((c: any) => c.id === rootCategoryId)).toBe(false);
    const selfActivate = await post(`/api/v1/catalog/admin/categories/${rootCategoryId}/activate`, taxonomyCreator, { version: 1, reason: 'self activation attempt' }).expect(403);
    expect(selfActivate.body.code).toBe('SELF_ACTIVATION_DENIED');
    const noPerm = await makeUser('taxonomy-no-perm');
    await post(`/api/v1/catalog/admin/categories/${rootCategoryId}/activate`, noPerm, { version: 1, reason: 'attempt activation' }).expect(403);
    await post(`/api/v1/catalog/admin/categories/${rootCategoryId}/activate`, taxonomyActivator, { version: 1, reason: 'taxonomy verified' }).expect(201);
    const child = await post('/api/v1/catalog/admin/categories', taxonomyCreator, { countryId, parentId: rootCategoryId, name: `Lighting ${suffix}`, slug: `lighting-${suffix}` }).expect(201);
    childCategoryId = child.body.id;
    await post(`/api/v1/catalog/admin/categories/${childCategoryId}/activate`, taxonomyActivator, { version: 1, reason: 'child taxonomy verified' }).expect(201);
    const grandchild = await post('/api/v1/catalog/admin/categories', taxonomyCreator, { countryId, parentId: childCategoryId, name: `Lamps ${suffix}`, slug: `lamps-${suffix}` }).expect(201);
    await post(`/api/v1/catalog/admin/categories/${grandchild.body.id}/activate`, taxonomyActivator, { version: 1, reason: 'grandchild taxonomy verified' }).expect(201);
    const tooDeep = await post('/api/v1/catalog/admin/categories', taxonomyCreator, { countryId, parentId: grandchild.body.id, name: `Too Deep ${suffix}`, slug: `too-deep-${suffix}` }).expect(409);
    expect(tooDeep.body.code).toBe('CATEGORY_DEPTH_INVALID');
    const publicAfter = await publicGet(`/api/v1/public/catalog/categories?countryId=${countryId}`).expect(200);
    expect(publicAfter.body.some((c: any) => c.id === childCategoryId)).toBe(true);
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "Category" SET status='SUSPENDED', version=2 WHERE id=$1`, [rootCategoryId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Category" SET status='DRAFT', version=3 WHERE id=$1`, [rootCategoryId]))).rejects.toThrow(/category_invalid_transition/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Category" SET name='Smuggled rename', status='SUSPENDED', version=3 WHERE id=$1`, [rootCategoryId]))).rejects.toThrow(/category_content_immutable/);
  });

  it('quarantines product images, requires independent review, and only serves approved bytes for eligible published products', async () => {
    const productId = await createDraftProduct(`Taxonomy Media Lamp ${randomUUID().slice(0, 8)}`);
    await post(`/api/v1/catalog/products/${productId}/category`, owner, { categoryId: childCategoryId, version: 1 }).expect(201);
    const objectId = await uploadProductImage(owner);
    await post(`/api/v1/storage/objects/${objectId}/download-url`, owner).expect(400);
    const attached = await post(`/api/v1/catalog/products/${productId}/images`, owner, { storageObjectId: objectId, altText: 'Front view of the lamp', sortOrder: 0 }).expect(201);
    publishedImageId = attached.body.imageId;
    const pendingSubmit = await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 2 }).expect(409);
    expect(pendingSubmit.body.code).toBe('PRODUCT_PENDING_IMAGES_REQUIRED_REVIEW');
    const noPerm = await makeUser('media-no-perm');
    await post(`/api/v1/catalog/admin/product-images/${publishedImageId}/review`, noPerm, { version: 1, decision: 'APPROVE', reason: 'attempted review' }).expect(403);
    const noStep = await makeUser('media-no-step'); await grantKeys(noStep, ['catalog:product-image:review'], { stepUp: false });
    const stepDenied = await post(`/api/v1/catalog/admin/product-images/${publishedImageId}/review`, noStep, { version: 1, decision: 'APPROVE', reason: 'attempted review' }).expect(403);
    expect(stepDenied.body.code).toBe('STEP_UP_REQUIRED');
    await grantKeys(owner, ['catalog:product-image:review']);
    const selfReview = await post(`/api/v1/catalog/admin/product-images/${publishedImageId}/review`, owner, { version: 1, decision: 'APPROVE', reason: 'self review attempt' }).expect(403);
    expect(selfReview.body.code).toBe('PRODUCT_IMAGE_SELF_REVIEW_DENIED');
    const reviewDl = await post(`/api/v1/catalog/admin/product-images/${publishedImageId}/review-download-url`, mediaReviewer).expect(201);
    const reviewBytes = await request(app.getHttpServer()).get(reviewDl.body.downloadUrl).expect(200);
    expect(Buffer.from(reviewBytes.body).equals(png)).toBe(true);
    await post(`/api/v1/catalog/admin/product-images/${publishedImageId}/review`, mediaReviewer, { version: 1, decision: 'APPROVE', reason: 'image matches product policy' }).expect(201);
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 2 }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/review`, productModerator, { version: 3, decision: 'APPROVE', reason: 'product content verified' }).expect(201);
    await post(`/api/v1/catalog/admin/products/${productId}/publish`, productModerator, { version: 4, reason: 'approved for public catalog' }).expect(201);
    publishedProductId = productId;
    const detail = await publicGet(`/api/v1/public/catalog/products/${productId}?countryId=${countryId}`).expect(200);
    expect(detail.body.category.id).toBe(childCategoryId);
    expect(detail.body.images).toHaveLength(1);
    const imageBytes = await publicGet(detail.body.images[0].url).expect(200);
    expect(imageBytes.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(imageBytes.body).equals(png)).toBe(true);
    const filtered = await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&categoryId=${childCategoryId}`).expect(200);
    expect(filtered.body.items.some((p: any) => p.id === productId)).toBe(true);
    const images = await get(`/api/v1/catalog/products/${productId}/images`, owner).expect(200);
    expect(images.body[0].state).toBe('APPROVED');
  });

  it('rejects invalid image uploads/attachments and enforces database write guards', async () => {
    const productId = await createDraftProduct(`Invalid Media ${randomUUID().slice(0, 8)}`);
    await post('/api/v1/storage/uploads', owner, { purpose: 'product-image', contentType: 'text/html', sizeBytes: 10 }).expect(400);
    await post('/api/v1/storage/uploads', owner, { purpose: 'product-image', contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }).expect(400);
    const kycObjectId = await makeStorageObject(owner.userId);
    const badAttach = await post(`/api/v1/catalog/products/${productId}/images`, owner, { storageObjectId: kycObjectId, altText: 'Not a product image', sortOrder: 0 }).expect(409);
    expect(badAttach.body.code).toBe('PRODUCT_IMAGE_STORAGE_NOT_READY');
    const objectId = await uploadProductImage(owner);
    const badAlt = await post(`/api/v1/catalog/products/${productId}/images`, owner, { storageObjectId: objectId, altText: 'no', sortOrder: 0 }).expect(400);
    expect(badAlt.body.code).toBe('PRODUCT_IMAGE_ALT_TEXT_INVALID');
    const attached = await post(`/api/v1/catalog/products/${productId}/images`, owner, { storageObjectId: objectId, altText: 'Valid product image', sortOrder: 0 }).expect(201);
    await expect(asUser(u.runtime, owner.userId, c => c.query(`UPDATE "ProductImage" SET state='APPROVED', version=2 WHERE id=$1`, [attached.body.imageId]))).rejects.toThrow(/permission denied/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "ProductImage" SET state='APPROVED', version=2, "reviewedAt"=now(), "reviewedByUserId"=$2, "reviewReason"='direct approval attempt' WHERE id=$1`, [attached.body.imageId, mediaReviewer.userId]))).rejects.toThrow(/product_image_storage_not_approved/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "ProductImage" SET "altText"='Smuggled alt text', state='REJECTED', version=2, "reviewedAt"=now(), "reviewedByUserId"=$2, "reviewReason"='direct rejection attempt' WHERE id=$1`, [attached.body.imageId, mediaReviewer.userId]))).rejects.toThrow(/product_image_content_immutable/);
    await expect(asSuper(u.privileged, c => c.query(`UPDATE "Product" SET title='Smuggled title', status='ARCHIVED', version=2 WHERE id=$1`, [productId]))).rejects.toThrow(/product_content_immutable/);
    const rejected = await post(`/api/v1/catalog/admin/product-images/${attached.body.imageId}/review`, mediaReviewer, { version: 1, decision: 'REJECT', reason: 'image does not match policy' }).expect(201);
    expect(rejected.body.state).toBe('REJECTED');
    await post(`/api/v1/catalog/products/${productId}/submit`, owner, { version: 1 }).expect(201);
  });

  it('fails closed for public catalog and image reads when the assigned category chain is suspended', async () => {
    await publicGet(`/api/v1/public/catalog/products/${publishedProductId}?countryId=${countryId}`).expect(200);
    const child = await asSuper(u.privileged, async c => (await c.query(`SELECT version FROM "Category" WHERE id=$1`, [childCategoryId])).rows[0].version as number);
    await post(`/api/v1/catalog/admin/categories/${childCategoryId}/suspend`, taxonomyActivator, { version: child, reason: 'taxonomy policy investigation' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${publishedProductId}?countryId=${countryId}`).expect(404);
    await publicGet(`/api/v1/public/catalog/products/${publishedProductId}/images/${publishedImageId}?countryId=${countryId}`).expect(404);
    await publicGet(`/api/v1/public/catalog/products?countryId=${countryId}&categoryId=${childCategoryId}`).expect(404);
    const publicCategories = await publicGet(`/api/v1/public/catalog/categories?countryId=${countryId}`).expect(200);
    expect(publicCategories.body.some((c: any) => c.id === childCategoryId)).toBe(false);
    await post(`/api/v1/catalog/admin/categories/${childCategoryId}/activate`, taxonomyActivator, { version: child + 1, reason: 'taxonomy investigation resolved' }).expect(201);
    await publicGet(`/api/v1/public/catalog/products/${publishedProductId}?countryId=${countryId}`).expect(200);
    await publicGet(`/api/v1/public/catalog/products/${publishedProductId}/images/${publishedImageId}?countryId=${countryId}`).expect(200);
  });
});
