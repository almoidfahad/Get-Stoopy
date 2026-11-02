import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { assertVariantPrice, authorize, hasPermission, inGeographicScope, isPartyActiveWithKyc, parsePriceMinor, type AccessContext } from '@getstoopy/core';

export interface CreateStoreInput { vendorId: string; cityId: string; name: string; slug: string; addressLine: string; }
export interface StoreDecisionInput { version: number; reason: string; }
export interface CreateProductInput { title: string; description: string; brand?: string; }
export interface CreateVariantInput { sku: string; optionValues: Record<string, unknown>; priceAmountMinor: string; compareAtAmountMinor?: string; currency: string; weightGrams?: number; }

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, ctx: AccessContext, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()})`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private reason(reason: string) {
    if (typeof reason !== 'string' || reason.trim().length < 8 || reason.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' });
    return reason.trim();
  }
  private deny(decision: { allow: boolean; reason?: string }) {
    if (decision.allow) return;
    if (decision.reason === 'GEOGRAPHIC_SCOPE_DENIED') throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
    throw new ForbiddenException({ code: decision.reason ?? 'PERMISSION_DENIED', message: 'Catalog permission denied' });
  }
  private async vendorMembership(ctx: AccessContext, vendorId: string, countryId: string, storeId?: string) {
    const decision = authorize(ctx, 'vendor:catalog:write', { vendorId, countryId, ...(storeId ? { storeId } : {}) }, { allowVendor: true });
    this.deny(decision);
  }
  private requireStoreAdmin(ctx: AccessContext, permission: string, countryId: string) {
    if (!hasPermission(ctx, permission)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Store administration permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
  }
  private variantJson(v: any) {
    return { ...v, priceAmountMinor: v.priceAmountMinor.toString(), ...(v.compareAtAmountMinor !== null && v.compareAtAmountMinor !== undefined ? { compareAtAmountMinor: v.compareAtAmountMinor.toString() } : { compareAtAmountMinor: null }) };
  }
  private async assertCityInCountry(tx: any, cityId: string, countryId: string) {
    const rows = await tx.$queryRaw`SELECT r."countryId", c."status" FROM "City" c JOIN "District" d ON d."id"=c."districtId" JOIN "Region" r ON r."id"=d."regionId" WHERE c."id"=${cityId}::uuid`;
    const city = (rows as any[])[0];
    if (!city || city.countryId !== countryId) throw new BadRequestException({ code: 'STORE_CITY_COUNTRY_MISMATCH', message: 'Store city must belong to the vendor country' });
    if (city.status !== 'ACTIVE') throw new BadRequestException({ code: 'STORE_CITY_NOT_ACTIVE', message: 'Store city is not active' });
  }
  private async assertVendorKyc(tx: any, vendorId: string) {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, include: { kycCase: true } });
    if (!vendor || !isPartyActiveWithKyc({ status: vendor.status, countryId: vendor.countryId, kycCase: vendor.kycCase }, 'VENDOR', vendor.countryId)) {
      throw new ConflictException({ code: 'STORE_VENDOR_KYC_REQUIRED', message: 'An active KYC-eligible vendor is required' });
    }
    return vendor;
  }

  async createStore(ctx: AccessContext, input: CreateStoreInput) {
    const name = input.name?.trim(); const slug = input.slug?.trim().toLowerCase(); const addressLine = input.addressLine?.trim();
    if (!name || name.length < 2 || name.length > 120) throw new BadRequestException({ code: 'STORE_NAME_INVALID', message: 'Store name must be 2-120 characters' });
    if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 140) throw new BadRequestException({ code: 'STORE_SLUG_INVALID', message: 'Store slug is invalid' });
    if (!addressLine || addressLine.length < 5 || addressLine.length > 500) throw new BadRequestException({ code: 'STORE_ADDRESS_INVALID', message: 'Store address is invalid' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, vendor.id, vendor.countryId);
      await this.assertCityInCountry(tx, input.cityId, vendor.countryId);
      const existing = await tx.store.findUnique({ where: { vendorId_slug: { vendorId: vendor.id, slug } } });
      if (existing) {
        if (existing.name === name && existing.cityId === input.cityId && existing.addressLine === addressLine) return { storeId: existing.id, status: existing.status, version: existing.version, duplicate: true };
        throw new ConflictException({ code: 'STORE_SLUG_CONFLICT', message: 'Store slug already exists with different payload' });
      }
      const store = await tx.store.create({ data: { vendorId: vendor.id, countryId: vendor.countryId, cityId: input.cityId, name, slug, addressLine } });
      await this.audit(tx, ctx, 'catalog.store.created', 'Store', store.id, store.countryId);
      await this.outbox(tx, 'Store', store.id, 'catalog.store.created', `store-created-${store.id}`, store.countryId, { version: store.version, vendorId: vendor.id });
      return { storeId: store.id, status: store.status, version: store.version, duplicate: false };
    });
  }

  async listStores(ctx: AccessContext, vendorId: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, vendor.id, vendor.countryId);
      return tx.store.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' } });
    });
  }

  async activateStore(ctx: AccessContext, storeId: string, input: StoreDecisionInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT s."id", s."vendorId", s."countryId", s."status", s."version", v."ownerUserId" FROM "Store" s JOIN "Vendor" v ON v."id"=s."vendorId" WHERE s."id"=${storeId}::uuid FOR UPDATE OF s`;
      const store = (rows as any[])[0];
      if (!store) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      this.requireStoreAdmin(ctx, 'catalog:store:activate', store.countryId);
      if (store.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_ACTIVATION_DENIED', message: 'Owner cannot activate their own store' });
      if (store.version !== input.version) throw new ConflictException({ code: 'STORE_VERSION_CONFLICT', message: 'Store version conflict' });
      if (!['DRAFT', 'SUSPENDED'].includes(store.status)) throw new ConflictException({ code: 'STORE_INVALID_TRANSITION', message: 'Store cannot be activated from this state' });
      await this.assertVendorKyc(tx, store.vendorId);
      const updated = await tx.store.update({ where: { id: storeId }, data: { status: 'ACTIVE', activatedAt: new Date(), activatedByUserId: ctx.userId, suspendedAt: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.store.activated', 'Store', storeId, store.countryId, reason);
      await this.outbox(tx, 'Store', storeId, 'catalog.store.activated', `store-activated-${storeId}-${updated.version}`, store.countryId, { version: updated.version });
      return { storeId, status: updated.status, version: updated.version };
    });
  }

  async suspendStore(ctx: AccessContext, storeId: string, input: StoreDecisionInput) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","countryId","status","version" FROM "Store" WHERE "id"=${storeId}::uuid FOR UPDATE`;
      const store = (rows as any[])[0];
      if (!store) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      this.requireStoreAdmin(ctx, 'catalog:store:suspend', store.countryId);
      if (store.version !== input.version) throw new ConflictException({ code: 'STORE_VERSION_CONFLICT', message: 'Store version conflict' });
      if (store.status !== 'ACTIVE') throw new ConflictException({ code: 'STORE_INVALID_TRANSITION', message: 'Store cannot be suspended from this state' });
      const updated = await tx.store.update({ where: { id: storeId }, data: { status: 'SUSPENDED', suspendedAt: new Date(), version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.store.suspended', 'Store', storeId, store.countryId, reason);
      await this.outbox(tx, 'Store', storeId, 'catalog.store.suspended', `store-suspended-${storeId}-${updated.version}`, store.countryId, { version: updated.version });
      return { storeId, status: updated.status, version: updated.version };
    });
  }

  async createProduct(ctx: AccessContext, storeId: string, input: CreateProductInput) {
    const title = input.title?.trim(); const description = input.description?.trim();
    if (!title || title.length < 2 || title.length > 200) throw new BadRequestException({ code: 'PRODUCT_TITLE_INVALID', message: 'Product title is invalid' });
    if (!description || description.length < 10 || description.length > 5000) throw new BadRequestException({ code: 'PRODUCT_DESCRIPTION_INVALID', message: 'Product description is invalid' });
    if (input.brand !== undefined && input.brand.trim().length > 120) throw new BadRequestException({ code: 'PRODUCT_BRAND_INVALID', message: 'Product brand is invalid' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, store.vendorId, store.countryId, store.id);
      if (store.status !== 'ACTIVE') throw new ConflictException({ code: 'PRODUCT_STORE_NOT_ACTIVE', message: 'Product drafts require an active store' });
      await this.assertVendorKyc(tx, store.vendorId);
      const product = await tx.product.create({ data: { vendorId: store.vendorId, storeId: store.id, countryId: store.countryId, title, description, ...(input.brand?.trim() ? { brand: input.brand.trim() } : {}), createdByUserId: ctx.userId } });
      await this.audit(tx, ctx, 'catalog.product.created', 'Product', product.id, product.countryId);
      await this.outbox(tx, 'Product', product.id, 'catalog.product.created', `product-created-${product.id}`, product.countryId, { version: product.version, storeId: store.id });
      return { productId: product.id, status: product.status, version: product.version };
    });
  }

  async listProducts(ctx: AccessContext, storeId: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, store.vendorId, store.countryId, store.id);
      return tx.product.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    });
  }

  async archiveProduct(ctx: AccessContext, productId: string, version: number) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","vendorId","storeId","countryId","status","version" FROM "Product" WHERE "id"=${productId}::uuid FOR UPDATE`;
      const product = (rows as any[])[0];
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, product.vendorId, product.countryId, product.storeId);
      if (product.version !== version) throw new ConflictException({ code: 'PRODUCT_VERSION_CONFLICT', message: 'Product version conflict' });
      if (product.status === 'ARCHIVED') throw new ConflictException({ code: 'PRODUCT_INVALID_TRANSITION', message: 'Product is already archived' });
      const updated = await tx.product.update({ where: { id: productId }, data: { status: 'ARCHIVED', version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.product.archived', 'Product', productId, product.countryId);
      await this.outbox(tx, 'Product', productId, 'catalog.product.archived', `product-archived-${productId}-${updated.version}`, product.countryId, { version: updated.version });
      return { productId, status: updated.status, version: updated.version };
    });
  }

  async createVariant(ctx: AccessContext, productId: string, input: CreateVariantInput) {
    if (!input.sku || input.sku.trim().length < 1 || input.sku.trim().length > 120) throw new BadRequestException({ code: 'VARIANT_SKU_INVALID', message: 'Variant SKU is invalid' });
    if (!input.optionValues || typeof input.optionValues !== 'object' || Array.isArray(input.optionValues)) throw new BadRequestException({ code: 'VARIANT_OPTIONS_INVALID', message: 'Variant options must be an object' });
    let price: bigint; let compareAt: bigint | null = null;
    try { price = parsePriceMinor(input.priceAmountMinor); if (input.compareAtAmountMinor !== undefined) compareAt = parsePriceMinor(input.compareAtAmountMinor); } catch { throw new BadRequestException({ code: 'PRICE_MINOR_INVALID', message: 'Price must be positive integer minor units' }); }
    if (input.weightGrams !== undefined && (!Number.isInteger(input.weightGrams) || input.weightGrams <= 0)) throw new BadRequestException({ code: 'VARIANT_WEIGHT_INVALID', message: 'Variant weight is invalid' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const product = await tx.product.findUnique({ where: { id: productId }, include: { store: true, country: true } });
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, product.vendorId, product.countryId, product.storeId);
      if (product.status === 'ARCHIVED') throw new ConflictException({ code: 'VARIANT_PRODUCT_ARCHIVED', message: 'Cannot add variants to an archived product' });
      if (product.status === 'PUBLISHED') throw new ConflictException({ code: 'VARIANT_PRODUCT_PUBLISHED_LOCKED', message: 'Published product variants are locked; unpublish before editing' });
      try { assertVariantPrice(price, compareAt, input.currency, product.country.currencyCode); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'PRICE_INVALID', message: 'Variant price/currency is invalid' }); }
      const existing = await tx.productVariant.findUnique({ where: { productId_sku: { productId, sku: input.sku.trim() } } });
      if (existing) throw new ConflictException({ code: 'VARIANT_SKU_CONFLICT', message: 'Variant SKU already exists for this product' });
      const variant = await tx.productVariant.create({ data: { productId, sku: input.sku.trim(), optionValues: input.optionValues as any, priceAmountMinor: price, ...(compareAt !== null ? { compareAtAmountMinor: compareAt } : {}), currency: input.currency, ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}) } });
      await this.audit(tx, ctx, 'catalog.variant.created', 'Product', productId, product.countryId);
      await this.outbox(tx, 'Product', productId, 'catalog.variant.created', `variant-created-${variant.id}`, product.countryId, { variantId: variant.id, version: variant.version });
      return this.variantJson(variant);
    });
  }

  async listVariants(ctx: AccessContext, productId: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, product.vendorId, product.countryId, product.storeId);
      const variants = await tx.productVariant.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } });
      return variants.map(v => this.variantJson(v));
    });
  }
  private requireProductAdmin(ctx: AccessContext, permission: string, countryId: string) {
    if (!hasPermission(ctx, permission)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Product moderation/publication permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId })) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
  }
  private async assertPublishable(tx: any, product: any) {
    const store = await tx.store.findUnique({ where: { id: product.storeId } });
    if (!store || store.status !== 'ACTIVE') throw new ConflictException({ code: 'PRODUCT_STORE_NOT_ACTIVE', message: 'Product requires an active store' });
    await this.assertVendorKyc(tx, product.vendorId);
    const variants = await tx.productVariant.count({ where: { productId: product.id, active: true } });
    if (variants < 1) throw new ConflictException({ code: 'PRODUCT_ACTIVE_VARIANT_REQUIRED', message: 'Product requires at least one active variant' });
  }

  async submitProduct(ctx: AccessContext, productId: string, version: number) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","vendorId","storeId","countryId","status","moderationState","version" FROM "Product" WHERE "id"=${productId}::uuid FOR UPDATE`;
      const product = (rows as any[])[0];
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      await this.vendorMembership(ctx, product.vendorId, product.countryId, product.storeId);
      if (product.version !== version) throw new ConflictException({ code: 'PRODUCT_VERSION_CONFLICT', message: 'Product version conflict' });
      if (product.status !== 'DRAFT' || !['NOT_SUBMITTED', 'REJECTED'].includes(product.moderationState)) throw new ConflictException({ code: 'PRODUCT_MODERATION_INVALID_TRANSITION', message: 'Product cannot be submitted from this state' });
      await this.assertPublishable(tx, product);
      const updated = await tx.product.update({ where: { id: productId }, data: { moderationState: 'PENDING_REVIEW', submittedAt: new Date(), moderationReason: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.product.submitted', 'Product', productId, product.countryId);
      await this.outbox(tx, 'Product', productId, 'catalog.product.submitted', `product-submitted-${productId}-${updated.version}`, product.countryId, { version: updated.version });
      return { productId, status: updated.status, moderationState: updated.moderationState, version: updated.version };
    });
  }

  async reviewProduct(ctx: AccessContext, productId: string, input: { version: number; decision: 'APPROVE' | 'REJECT'; reason: string }) {
    const reason = this.reason(input.reason);
    if (!['APPROVE', 'REJECT'].includes(input.decision)) throw new BadRequestException({ code: 'PRODUCT_DECISION_INVALID', message: 'Invalid moderation decision' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT p."id", p."vendorId", p."countryId", p."status", p."moderationState", p."version", p."createdByUserId", v."ownerUserId" FROM "Product" p JOIN "Vendor" v ON v."id"=p."vendorId" WHERE p."id"=${productId}::uuid FOR UPDATE OF p`;
      const product = (rows as any[])[0];
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      this.requireProductAdmin(ctx, 'catalog:product:review', product.countryId);
      if (product.createdByUserId === ctx.userId || product.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Creator/owner cannot review their own product' });
      if (product.version !== input.version) throw new ConflictException({ code: 'PRODUCT_VERSION_CONFLICT', message: 'Product version conflict' });
      if (product.status !== 'DRAFT' || product.moderationState !== 'PENDING_REVIEW') throw new ConflictException({ code: 'PRODUCT_MODERATION_INVALID_TRANSITION', message: 'Product is not pending review' });
      const moderationState = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.product.update({ where: { id: productId }, data: { moderationState, moderationReason: reason, reviewedAt: new Date(), reviewedByUserId: ctx.userId, version: { increment: 1 } } });
      await this.audit(tx, ctx, `catalog.product.${input.decision.toLowerCase()}`, 'Product', productId, product.countryId, reason);
      await this.outbox(tx, 'Product', productId, 'catalog.product.reviewed', `product-reviewed-${productId}-${updated.version}`, product.countryId, { version: updated.version, decision: input.decision });
      return { productId, status: updated.status, moderationState: updated.moderationState, version: updated.version };
    });
  }

  async publishProduct(ctx: AccessContext, productId: string, input: { version: number; reason: string }) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT p."id", p."vendorId", p."storeId", p."countryId", p."status", p."moderationState", p."version", p."createdByUserId", v."ownerUserId" FROM "Product" p JOIN "Vendor" v ON v."id"=p."vendorId" WHERE p."id"=${productId}::uuid FOR UPDATE OF p`;
      const product = (rows as any[])[0];
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      this.requireProductAdmin(ctx, 'catalog:product:publish', product.countryId);
      if (product.createdByUserId === ctx.userId || product.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_PUBLICATION_DENIED', message: 'Creator/owner cannot publish their own product' });
      if (product.version !== input.version) throw new ConflictException({ code: 'PRODUCT_VERSION_CONFLICT', message: 'Product version conflict' });
      if (product.status !== 'DRAFT' || product.moderationState !== 'APPROVED') throw new ConflictException({ code: 'PRODUCT_MODERATION_APPROVED_REQUIRED', message: 'Approved moderation is required before publication' });
      await this.assertPublishable(tx, product);
      const updated = await tx.product.update({ where: { id: productId }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: ctx.userId, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.product.published', 'Product', productId, product.countryId, reason);
      await this.outbox(tx, 'Product', productId, 'catalog.product.published', `product-published-${productId}-${updated.version}`, product.countryId, { version: updated.version });
      return { productId, status: updated.status, moderationState: updated.moderationState, version: updated.version };
    });
  }

  async unpublishProduct(ctx: AccessContext, productId: string, input: { version: number; reason: string }) {
    const reason = this.reason(input.reason);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const rows = await tx.$queryRaw`SELECT "id","countryId","status","version" FROM "Product" WHERE "id"=${productId}::uuid FOR UPDATE`;
      const product = (rows as any[])[0];
      if (!product) throw new NotFoundException({ code: 'CATALOG_RESOURCE_NOT_FOUND', message: 'Catalog resource not found' });
      this.requireProductAdmin(ctx, 'catalog:product:publish', product.countryId);
      if (product.version !== input.version) throw new ConflictException({ code: 'PRODUCT_VERSION_CONFLICT', message: 'Product version conflict' });
      if (product.status !== 'PUBLISHED') throw new ConflictException({ code: 'PRODUCT_INVALID_TRANSITION', message: 'Only published products can be unpublished' });
      const updated = await tx.product.update({ where: { id: productId }, data: { status: 'DRAFT', publishedAt: null, publishedByUserId: null, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'catalog.product.unpublished', 'Product', productId, product.countryId, reason);
      await this.outbox(tx, 'Product', productId, 'catalog.product.unpublished', `product-unpublished-${productId}-${updated.version}`, product.countryId, { version: updated.version });
      return { productId, status: updated.status, moderationState: updated.moderationState, version: updated.version };
    });
  }

  async moderationQueue(ctx: AccessContext, countryId: string, moderationState: string | undefined, limit: number, cursor?: string) {
    this.requireProductAdmin(ctx, 'catalog:product:review', countryId);
    const states = ['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'];
    if (moderationState !== undefined && !states.includes(moderationState)) throw new BadRequestException({ code: 'MODERATION_STATE_INVALID', message: 'Invalid moderation state filter' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const items = await tx.product.findMany({ where: { countryId, ...(moderationState ? { moderationState: moderationState as any } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, vendorId: true, storeId: true, title: true, status: true, moderationState: true, version: true, submittedAt: true, createdAt: true } });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return { items: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }

  private publicWhere(countryId: string, cityId?: string, q?: string) {
    const now = new Date();
    return {
      status: 'PUBLISHED' as const,
      countryId,
      country: { status: 'ACTIVE' as const },
      store: { status: 'ACTIVE' as const, ...(cityId ? { cityId } : {}) },
      vendor: { status: 'ACTIVE' as const, kycCase: { status: 'APPROVED' as const, subjectType: 'VENDOR' as const, expiresAt: { gt: now } } },
      ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { brand: { contains: q, mode: 'insensitive' as const } }] } : {})
    };
  }
  private publicJson(p: any) {
    return { id: p.id, title: p.title, description: p.description, brand: p.brand, store: p.store ? { id: p.store.id, name: p.store.name, slug: p.store.slug, cityId: p.store.cityId } : undefined, currency: p.country?.currencyCode, variants: (p.variants ?? []).map((v: any) => this.variantJson(v)), publishedAt: p.publishedAt };
  }

  async publicList(input: { countryId: string; cityId?: string; q?: string; limit: number; cursor?: string }) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const country = await tx.country.findFirst({ where: { id: input.countryId, status: 'ACTIVE' } });
      if (!country) throw new NotFoundException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Country is not available' });
      if (input.cityId) {
        const rows = await tx.$queryRaw`SELECT r."countryId", c."status" FROM "City" c JOIN "District" d ON d."id"=c."districtId" JOIN "Region" r ON r."id"=d."regionId" WHERE c."id"=${input.cityId}::uuid`;
        const city = (rows as any[])[0];
        if (!city || city.countryId !== input.countryId || city.status !== 'ACTIVE') throw new NotFoundException({ code: 'CITY_NOT_AVAILABLE', message: 'City is not available' });
      }
      const items = await tx.product.findMany({ where: this.publicWhere(input.countryId, input.cityId, input.q), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), include: { store: { select: { id: true, name: true, slug: true, cityId: true } }, country: { select: { currencyCode: true } }, variants: { where: { active: true }, orderBy: { createdAt: 'asc' } } } });
      const hasMore = items.length > input.limit;
      const page = hasMore ? items.slice(0, input.limit) : items;
      return { items: page.map(p => this.publicJson(p)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }

  async publicDetail(productId: string, countryId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const p = await tx.product.findFirst({ where: { id: productId, ...this.publicWhere(countryId) }, include: { store: { select: { id: true, name: true, slug: true, cityId: true } }, country: { select: { currencyCode: true } }, variants: { where: { active: true }, orderBy: { createdAt: 'asc' } } } });
      if (!p) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
      return this.publicJson(p);
    });
  }

}
