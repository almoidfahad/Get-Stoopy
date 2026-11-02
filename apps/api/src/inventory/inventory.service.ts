import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { assertReservationQuantity, assertReservationTtl, assertStockAdjustment, authorize, availableToPromise, DEFAULT_RESERVATION_TTL_SECONDS, type AccessContext } from '@getstoopy/core';

export interface StockAdjustmentInput { version: number; delta: number; commandKey: string; reason: string; }
export interface ReserveStockInput { userId: string; variantId: string; quantity: number; commandKey: string; ttlSeconds?: number; }

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function assertCommandKey(key: string): void { if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw new BadRequestException({ code: 'INVENTORY_COMMAND_KEY_INVALID', message: 'Invalid inventory command key' }); }
function assertReason(reason: string): string { const trimmed = reason?.trim(); if (!trimmed || trimmed.length < 8 || trimmed.length > 512) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'A reason is required' }); return trimmed; }

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService) {}

  private async audit(tx: any, actorUserId: string | null, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${actorUserId}::uuid, ${actorUserId ? 'USER' : 'SYSTEM'}::"ActorType", ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'Inventory', aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'Inventory', aggregateId, countryId, data } } });
  }
  private inventoryJson(i: any) { return { inventoryId: i.id, variantId: i.variantId, storeId: i.storeId, vendorId: i.vendorId, countryId: i.countryId, onHand: i.onHand, reserved: i.reserved, availableToPromise: availableToPromise(i.onHand, i.reserved), reorderLevel: i.reorderLevel, version: i.version, updatedAt: i.updatedAt }; }
  private async vendorPermission(ctx: AccessContext, vendorId: string, countryId: string, storeId: string, permission: string) {
    const decision = authorize(ctx, permission, { vendorId, countryId, storeId }, { allowVendor: true });
    if (decision.allow) return;
    if (decision.reason === 'GEOGRAPHIC_SCOPE_DENIED') throw new NotFoundException({ code: 'INVENTORY_RESOURCE_NOT_FOUND', message: 'Inventory resource not found' });
    throw new ForbiddenException({ code: decision.reason ?? 'PERMISSION_DENIED', message: 'Inventory permission denied' });
  }
  private async lockVariant(tx: any, variantId: string) {
    const rows = await tx.$queryRaw`SELECT v."id" AS "variantId", v."active", p."id" AS "productId", p."storeId", p."vendorId", p."countryId", p."status" AS "productStatus" FROM "ProductVariant" v JOIN "Product" p ON p."id"=v."productId" WHERE v."id"=${variantId}::uuid FOR UPDATE OF v`;
    const variant = (rows as any[])[0];
    if (!variant) throw new NotFoundException({ code: 'INVENTORY_RESOURCE_NOT_FOUND', message: 'Inventory resource not found' });
    return variant;
  }
  private async lockInventoryByVariant(tx: any, variantId: string) {
    const rows = await tx.$queryRaw`SELECT * FROM "Inventory" WHERE "variantId"=${variantId}::uuid FOR UPDATE`;
    const inventory = (rows as any[])[0];
    if (!inventory) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND', message: 'Inventory is not initialized' });
    return inventory;
  }

  async initialize(ctx: AccessContext, variantId: string, input: { reorderLevel?: number }) {
    const reorderLevel = input.reorderLevel ?? 0;
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > 1_000_000) throw new BadRequestException({ code: 'REORDER_LEVEL_INVALID', message: 'Invalid reorder level' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const variant = await this.lockVariant(tx, variantId);
      await this.vendorPermission(ctx, variant.vendorId, variant.countryId, variant.storeId, 'vendor:inventory:write');
      if (!variant.active || variant.productStatus === 'ARCHIVED') throw new ConflictException({ code: 'INVENTORY_VARIANT_NOT_ACTIVE', message: 'Variant is not active' });
      const existing = await tx.inventory.findUnique({ where: { variantId } });
      if (existing) {
        if (existing.reorderLevel !== reorderLevel) throw new ConflictException({ code: 'INVENTORY_ALREADY_INITIALIZED', message: 'Inventory already initialized with different reorder level' });
        return { ...this.inventoryJson(existing), duplicate: true };
      }
      const inventory = await tx.inventory.create({ data: { variantId, storeId: variant.storeId, vendorId: variant.vendorId, countryId: variant.countryId, reorderLevel } });
      await this.audit(tx, ctx.userId, 'inventory.initialized', 'Inventory', inventory.id, inventory.countryId);
      await this.outbox(tx, inventory.id, 'inventory.initialized', `inventory-initialized-${inventory.id}`, inventory.countryId, { variantId, version: inventory.version });
      return { ...this.inventoryJson(inventory), duplicate: false };
    });
  }

  async get(ctx: AccessContext, variantId: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const inventory = await tx.inventory.findUnique({ where: { variantId } });
      if (!inventory) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND', message: 'Inventory is not initialized' });
      await this.vendorPermission(ctx, inventory.vendorId, inventory.countryId, inventory.storeId, 'vendor:inventory:read');
      return this.inventoryJson(inventory);
    });
  }

  async adjust(ctx: AccessContext, variantId: string, input: StockAdjustmentInput) {
    assertCommandKey(input.commandKey); const reason = assertReason(input.reason);
    try { assertStockAdjustment(input.delta); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'STOCK_ADJUSTMENT_INVALID', message: 'Invalid stock adjustment' }); }
    const payloadHash = hashPayload({ variantId, version: input.version, delta: input.delta, reason });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const variant = await this.lockVariant(tx, variantId);
      await this.vendorPermission(ctx, variant.vendorId, variant.countryId, variant.storeId, 'vendor:inventory:write');
      const inventory = await this.lockInventoryByVariant(tx, variantId);
      const existing = await tx.inventoryMovement.findUnique({ where: { inventoryId_commandKey: { inventoryId: inventory.id, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'INVENTORY_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { ...this.inventoryJson(inventory), duplicate: true };
      }
      if (inventory.version !== input.version) throw new ConflictException({ code: 'INVENTORY_VERSION_CONFLICT', message: 'Inventory version conflict' });
      const onHand = inventory.onHand + input.delta;
      if (onHand < inventory.reserved || onHand > 1_000_000) throw new ConflictException({ code: 'INVENTORY_BOUNDS_INVALID', message: 'Adjustment would violate stock bounds' });
      const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { onHand, version: { increment: 1 } } });
      await tx.inventoryMovement.create({ data: { inventoryId: inventory.id, inventoryVersion: updated.version, kind: 'ADJUST', commandKey: input.commandKey, payloadHash, onHandDelta: input.delta, reservedDelta: 0, onHandAfter: updated.onHand, reservedAfter: updated.reserved, reason, actorUserId: ctx.userId } });
      await this.audit(tx, ctx.userId, 'inventory.adjusted', 'Inventory', inventory.id, inventory.countryId, reason);
      await this.outbox(tx, inventory.id, 'inventory.adjusted', `inventory-adjusted-${inventory.id}-${updated.version}`, inventory.countryId, { version: updated.version, onHandDelta: input.delta });
      return { ...this.inventoryJson(updated), duplicate: false };
    });
  }

  async movements(ctx: AccessContext, variantId: string, limit: number, cursor?: string) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const inventory = await tx.inventory.findUnique({ where: { variantId } });
      if (!inventory) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND', message: 'Inventory is not initialized' });
      await this.vendorPermission(ctx, inventory.vendorId, inventory.countryId, inventory.storeId, 'vendor:inventory:read');
      const items = await tx.inventoryMovement.findMany({ where: { inventoryId: inventory.id }, orderBy: [{ inventoryVersion: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const hasMore = items.length > limit; const page = hasMore ? items.slice(0, limit) : items;
      return { items: page.map(m => ({ id: m.id, kind: m.kind, inventoryVersion: m.inventoryVersion, onHandDelta: m.onHandDelta, reservedDelta: m.reservedDelta, onHandAfter: m.onHandAfter, reservedAfter: m.reservedAfter, reason: m.reason, createdAt: m.createdAt })), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }

  /** Internal checkout-facing command. No public HTTP route is exposed until checkout quote orchestration exists. */
  async reserveStock(input: ReserveStockInput) {
    assertCommandKey(input.commandKey);
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_RESERVATION_TTL_SECONDS;
    try { assertReservationQuantity(input.quantity); assertReservationTtl(ttlSeconds); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'RESERVATION_INVALID', message: 'Invalid reservation' }); }
    const payloadHash = hashPayload({ variantId: input.variantId, quantity: input.quantity, ttlSeconds });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: input.userId, authorizationVersion: 0, isSuper: true });
      const variant = await this.lockVariant(tx, input.variantId);
      const inventory = await this.lockInventoryByVariant(tx, input.variantId);
      const existing = await tx.inventoryReservation.findUnique({ where: { userId_commandKey: { userId: input.userId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'RESERVATION_IDEMPOTENCY_CONFLICT', message: 'Reservation command key already used with different payload' });
        return { reservationId: existing.id, state: existing.state, quantity: existing.quantity, expiresAt: existing.expiresAt, duplicate: true };
      }
      if (!variant.active || variant.productStatus !== 'PUBLISHED') throw new ConflictException({ code: 'RESERVATION_NOT_SELLABLE', message: 'Variant is not sellable' });
      const sellable = await tx.$queryRaw`SELECT (s."status"='ACTIVE' AND c."status"='ACTIVE' AND gs_inventory_vendor_eligible(${inventory.vendorId}::uuid) AND s."countryId"=${inventory.countryId}::uuid) AS ok FROM "Store" s JOIN "Country" c ON c."id"=s."countryId" WHERE s."id"=${inventory.storeId}::uuid`;
      if (!(sellable as any[])[0]?.ok) throw new ConflictException({ code: 'RESERVATION_NOT_SELLABLE', message: 'Variant is not sellable' });
      if (availableToPromise(inventory.onHand, inventory.reserved) < input.quantity) throw new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const reservation = await tx.inventoryReservation.create({ data: { inventoryId: inventory.id, userId: input.userId, commandKey: input.commandKey, payloadHash, quantity: input.quantity, expiresAt } });
      const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { reserved: { increment: input.quantity }, version: { increment: 1 } } });
      await tx.inventoryMovement.create({ data: { inventoryId: inventory.id, inventoryVersion: updated.version, kind: 'RESERVE', commandKey: `reserve:${reservation.id}`, payloadHash: hashPayload({ reservationId: reservation.id, kind: 'RESERVE' }), reservationId: reservation.id, onHandDelta: 0, reservedDelta: input.quantity, onHandAfter: updated.onHand, reservedAfter: updated.reserved, reason: 'checkout stock reservation', actorUserId: input.userId } });
      await this.audit(tx, input.userId, 'inventory.reserved', 'InventoryReservation', reservation.id, inventory.countryId);
      await this.outbox(tx, inventory.id, 'inventory.reserved', `inventory-reserved-${reservation.id}`, inventory.countryId, { reservationId: reservation.id, quantity: input.quantity, version: updated.version });
      return { reservationId: reservation.id, state: reservation.state, quantity: reservation.quantity, expiresAt: reservation.expiresAt, duplicate: false };
    });
  }

  private async closeReservation(reservationId: string, target: 'RELEASED' | 'CONSUMED', actorUserId: string | null, reason: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: actorUserId ?? '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const probe = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
      if (!probe) throw new NotFoundException({ code: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' });
      const invRows = await tx.$queryRaw`SELECT * FROM "Inventory" WHERE "id"=${probe.inventoryId}::uuid FOR UPDATE`;
      const inventory = (invRows as any[])[0];
      const rows = await tx.$queryRaw`SELECT * FROM "InventoryReservation" WHERE "id"=${reservationId}::uuid FOR UPDATE`;
      const reservation = (rows as any[])[0];
      if (reservation.state === target) return { reservationId, state: reservation.state, duplicate: true };
      if (reservation.state !== 'ACTIVE') throw new ConflictException({ code: 'RESERVATION_INVALID_TRANSITION', message: 'Reservation is already closed' });
      if (target === 'CONSUMED' && reservation.expiresAt <= new Date()) throw new ConflictException({ code: 'RESERVATION_EXPIRED', message: 'Reservation expired' });
      const closed = await tx.inventoryReservation.update({ where: { id: reservationId }, data: { state: target, closedAt: new Date(), version: { increment: 1 } } });
      const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { reserved: { decrement: reservation.quantity }, ...(target === 'CONSUMED' ? { onHand: { decrement: reservation.quantity } } : {}), version: { increment: 1 } } });
      const kind = target === 'CONSUMED' ? 'CONSUME' : 'RELEASE';
      await tx.inventoryMovement.create({ data: { inventoryId: inventory.id, inventoryVersion: updated.version, kind, commandKey: `${kind.toLowerCase()}:${reservation.id}`, payloadHash: hashPayload({ reservationId: reservation.id, kind }), reservationId: reservation.id, onHandDelta: target === 'CONSUMED' ? -reservation.quantity : 0, reservedDelta: -reservation.quantity, onHandAfter: updated.onHand, reservedAfter: updated.reserved, reason, actorUserId } });
      await this.audit(tx, actorUserId, `inventory.${kind.toLowerCase()}`, 'InventoryReservation', reservation.id, inventory.countryId, reason);
      await this.outbox(tx, inventory.id, `inventory.${kind.toLowerCase()}`, `inventory-${kind.toLowerCase()}-${reservation.id}`, inventory.countryId, { reservationId: reservation.id, quantity: reservation.quantity, version: updated.version });
      return { reservationId, state: closed.state, duplicate: false };
    });
  }

  async releaseReservation(reservationId: string, actorUserId: string | null, reason: string) { return this.closeReservation(reservationId, 'RELEASED', actorUserId, assertReason(reason)); }
  async consumeReservation(reservationId: string, actorUserId: string | null, reason: string) { return this.closeReservation(reservationId, 'CONSUMED', actorUserId, assertReason(reason)); }

  async expireDueReservations(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new BadRequestException({ code: 'EXPIRY_BATCH_INVALID', message: 'Invalid expiry batch size' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const rows = await tx.$queryRaw`SELECT gs_expire_inventory_reservations(${limit}) AS expired`;
      return { expired: Number((rows as any[])[0]?.expired ?? 0) };
    });
  }

}
