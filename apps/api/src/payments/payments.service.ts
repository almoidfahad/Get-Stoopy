import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { assertWebhookAmountCurrency, hasPermission, inGeographicScope, sandboxManualCapabilities, verifySandboxWebhookSignature, type AccessContext } from '@getstoopy/core';
import { SandboxManualAdapter, DisabledLiveAdapter } from './adapters.js';
import { RiskSignalProducerService } from '../risk/risk-signal-producer.service.js';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function merchantReference(): string { return `PI-${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`; }

export interface SandboxWebhookPayload {
  eventId: string;
  merchantReference: string;
  providerReference?: string;
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  amountMinor: string;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private readonly sandbox = new SandboxManualAdapter();
  private readonly liveAdapters = [new DisabledLiveAdapter('SSLCOMMERZ'), new DisabledLiveAdapter('AAMARPAY'), new DisabledLiveAdapter('SHURJOPAY')];
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv, @Inject(RiskSignalProducerService) private readonly riskSignals: RiskSignalProducerService) {}

  private async audit(tx: any, actorUserId: string | null, action: string, resourceType: string, resourceId: string, countryId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${actorUserId}::uuid, ${actorUserId ? 'USER' : 'SYSTEM'}::"ActorType", ${action}, ${resourceType}, ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, aggregateType: string, aggregateId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType, aggregateId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType, aggregateId, countryId, data } } });
  }
  private intentJson(i: any, duplicate = false) {
    return { intentId: i.id, orderId: i.orderId, merchantReference: i.merchantReference, provider: i.provider, environment: i.environment, mode: 'TEST_ONLY', amountMinor: i.amountMinor.toString(), currency: i.currency, status: i.status, providerReference: i.providerReference, verificationMethod: i.verificationMethod, expiresAt: i.expiresAt, closedAt: i.closedAt, version: i.version, duplicate };
  }
  private requireSandboxEnabled() {
    if (this.env.PAYMENTS_LIVE_ENABLED) throw new ForbiddenException({ code: 'PAYMENTS_LIVE_NOT_AUTHORIZED', message: 'Live payments are not authorized' });
    if (!this.env.PAYMENTS_SANDBOX_ENABLED || !this.env.PAYMENT_SANDBOX_WEBHOOK_SECRET) throw new ForbiddenException({ code: 'PAYMENT_SANDBOX_DISABLED', message: 'Sandbox payments are disabled' });
  }

  capabilities() {
    return {
      liveEnabled: false,
      sandboxEnabled: !!this.env.PAYMENTS_SANDBOX_ENABLED,
      providers: [
        { provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', capabilities: sandboxManualCapabilities },
        ...this.liveAdapters.map(a => ({ provider: a.provider, environment: 'LIVE', capabilities: a.capabilities }))
      ],
      unsupported: ['refund', 'dynamicOrderQR', 'disburse', 'verifyBeneficiary', 'reconcileStatement']
    };
  }

  async createIntent(ctx: AccessContext, orderId: string, input: { commandKey: string }) {
    this.requireSandboxEnabled();
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(input.commandKey)) throw new BadRequestException({ code: 'PAYMENT_COMMAND_KEY_INVALID', message: 'Invalid payment command key' });
    const payloadHash = hashPayload({ orderId, provider: 'SANDBOX_MANUAL' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // Authorize and lock the order before looking up an idempotent replay.
      // The privileged client bypasses ordinary RLS, so a command key is never
      // proof of ownership. The lock also serializes concurrent same-order keys.
      const rows = await tx.$queryRaw`SELECT * FROM "Order" WHERE "id"=${orderId}::uuid AND "buyerId"=${ctx.userId}::uuid FOR UPDATE`;
      const order = (rows as any[])[0];
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      const existing = await tx.paymentIntent.findUnique({ where: { orderId_commandKey: { orderId, commandKey: input.commandKey } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'PAYMENT_IDEMPOTENCY_CONFLICT', message: 'Payment command key already used with different payload' });
        return this.intentJson(existing, true);
      }
      if (order.paymentMethod !== 'SANDBOX_MANUAL' || order.paymentStatus !== 'AWAITING_PAYMENT') throw new ConflictException({ code: 'PAYMENT_ORDER_NOT_PAYABLE', message: 'Order is not payable' });
      const active = await tx.paymentIntent.findFirst({ where: { orderId, status: { in: ['CREATED', 'PENDING', 'UNKNOWN'] } } });
      if (active) throw new ConflictException({ code: 'PAYMENT_INTENT_ALREADY_ACTIVE', message: 'An active payment intent already exists' });
      const ref = merchantReference();
      const checkout = await this.sandbox.createCheckout({ merchantReference: ref, amountMinor: order.amountMinor, currency: order.currency, orderId });
      const intent = await tx.paymentIntent.create({ data: { orderId, userId: ctx.userId, commandKey: input.commandKey, payloadHash, merchantReference: ref, provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', amountMinor: order.amountMinor, currency: order.currency, status: 'PENDING', expiresAt: new Date(Date.now() + 900_000) } });
      await this.audit(tx, ctx.userId, 'payment.intent.created', 'PaymentIntent', intent.id, order.countryId);
      await this.outbox(tx, 'PaymentIntent', intent.id, 'payment.intent.created', `payment-intent-created-${intent.id}`, order.countryId, { orderId, merchantReference: ref, amountMinor: intent.amountMinor.toString(), currency: intent.currency });
      return { ...this.intentJson(intent), checkout };
    });
  }

  async getIntent(ctx: AccessContext, intentId: string) {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const intent = await tx.paymentIntent.findFirst({ where: { id: intentId, userId: ctx.userId } });
      if (!intent) throw new NotFoundException({ code: 'PAYMENT_INTENT_NOT_FOUND', message: 'Payment intent not found' });
      return this.intentJson(intent);
    });
  }

  async sandboxWebhook(timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined) {
    this.requireSandboxEnabled();
    if (!rawBody || !timestamp || !signature) throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_REQUIRED', message: 'Webhook signature is required' });
    const bodyText = rawBody.toString('utf8');
    if (!verifySandboxWebhookSignature(this.env.PAYMENT_SANDBOX_WEBHOOK_SECRET!, timestamp, bodyText, signature)) throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Webhook signature is invalid or expired' });
    let payload: SandboxWebhookPayload;
    try { payload = JSON.parse(bodyText); } catch { throw new BadRequestException({ code: 'WEBHOOK_BODY_INVALID', message: 'Webhook body is invalid' }); }
    if (!payload || typeof payload.eventId !== 'string' || payload.eventId.length < 8 || payload.eventId.length > 128 || typeof payload.merchantReference !== 'string' || !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(payload.status) || typeof payload.amountMinor !== 'string' || typeof payload.currency !== 'string') throw new BadRequestException({ code: 'WEBHOOK_BODY_INVALID', message: 'Webhook body is invalid' });
    const dedupeKey = `SANDBOX_MANUAL:${payload.eventId}`;
    const payloadHash = hashPayload(payload);
    const redactedPayload = { eventId: payload.eventId, merchantReference: payload.merchantReference, providerReference: payload.providerReference ?? null, status: payload.status, amountMinor: payload.amountMinor, currency: payload.currency };
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const duplicate = await tx.paymentWebhookEvent.findUnique({ where: { dedupeKey } });
      if (duplicate) {
        if (duplicate.payloadHash !== payloadHash) throw new ConflictException({ code: 'WEBHOOK_IDEMPOTENCY_CONFLICT', message: 'Webhook event id already used with different payload' });
        return { accepted: true, duplicate: true, status: duplicate.status, eventId: payload.eventId };
      }
      const rows = await tx.$queryRaw`SELECT * FROM "PaymentIntent" WHERE "merchantReference"=${payload.merchantReference}::varchar FOR UPDATE`;
      const intent = (rows as any[])[0];
      if (!intent) {
        await tx.paymentWebhookEvent.create({ data: { provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', dedupeKey, providerEventId: payload.eventId, providerReference: payload.providerReference ?? null, merchantReference: payload.merchantReference, payloadHash, status: 'REJECTED', rejectionReason: 'INTENT_NOT_FOUND', redactedPayload } });
        return { accepted: false, duplicate: false, status: 'REJECTED', reason: 'INTENT_NOT_FOUND' };
      }
      try { assertWebhookAmountCurrency(intent.amountMinor, intent.currency, payload.amountMinor, payload.currency); } catch (e: any) {
        await tx.paymentWebhookEvent.create({ data: { provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', dedupeKey, providerEventId: payload.eventId, providerReference: payload.providerReference ?? null, merchantReference: payload.merchantReference, intentId: intent.id, payloadHash, status: 'REJECTED', rejectionReason: e.message ?? 'AMOUNT_INVALID', redactedPayload } });
        return { accepted: false, duplicate: false, status: 'REJECTED', reason: e.message ?? 'AMOUNT_INVALID' };
      }
      if (['VERIFIED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(intent.status)) {
        await tx.paymentWebhookEvent.create({ data: { provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', dedupeKey, providerEventId: payload.eventId, providerReference: payload.providerReference ?? null, merchantReference: payload.merchantReference, intentId: intent.id, payloadHash, status: 'IGNORED_OUT_OF_ORDER', redactedPayload } });
        return { accepted: true, duplicate: false, status: 'IGNORED_OUT_OF_ORDER' };
      }
      const nextStatus = payload.status === 'SUCCEEDED' ? 'VERIFIED' : payload.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
      const closedAt = nextStatus === 'UNKNOWN' ? null : new Date();
      const updated = await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: nextStatus, providerReference: payload.providerReference ?? null, verificationMethod: 'SANDBOX_HMAC_WEBHOOK', closedAt, version: { increment: 1 } } });
      const orderRows = await tx.$queryRaw`SELECT * FROM "Order" WHERE "id"=${intent.orderId}::uuid FOR UPDATE`;
      const order = (orderRows as any[])[0];
      if (nextStatus === 'VERIFIED' || nextStatus === 'FAILED') {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: nextStatus === 'VERIFIED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_FAILED', version: { increment: 1 } } });
      }
      await tx.paymentWebhookEvent.create({ data: { provider: 'SANDBOX_MANUAL', environment: 'SANDBOX', dedupeKey, providerEventId: payload.eventId, providerReference: payload.providerReference ?? null, merchantReference: payload.merchantReference, intentId: intent.id, payloadHash, status: 'APPLIED', redactedPayload } });
      await this.audit(tx, null, `payment.webhook.${nextStatus.toLowerCase()}`, 'PaymentIntent', intent.id, order.countryId);
      await this.outbox(tx, 'PaymentIntent', intent.id, `payment.intent.${nextStatus.toLowerCase()}`, `payment-intent-${nextStatus.toLowerCase()}-${intent.id}-${payload.eventId}`, order.countryId, { orderId: order.id, status: nextStatus, eventId: payload.eventId });
      if (nextStatus === 'FAILED') await this.riskSignals.paymentFailed(tx, intent.id);
      return { accepted: true, duplicate: false, status: 'APPLIED', intentStatus: updated.status };
    });
  }

  async upsertCodPolicy(ctx: AccessContext, input: { countryId: string; enabled: boolean; maxOrderMinor: string; version?: number }) {
    if (!hasPermission(ctx, 'finance:cod:manage')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'COD policy permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    if (!inGeographicScope(ctx, { countryId: input.countryId })) throw new NotFoundException({ code: 'COD_POLICY_NOT_FOUND', message: 'COD policy not found' });
    if (typeof input.maxOrderMinor !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.maxOrderMinor) || BigInt(input.maxOrderMinor) > 9223372036854775807n) throw new BadRequestException({ code: 'COD_MAX_INVALID', message: 'Invalid COD maximum' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      // Coordinate creation when the row does not yet exist, then lock existing
      // policy rows before checking their version. Orders use the same row lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cod-policy:${input.countryId.toLowerCase()}`}, 0))`;
      await tx.$queryRaw`SELECT "id" FROM "CodPolicy" WHERE "countryId"=${input.countryId}::uuid FOR UPDATE`;
      const existing = await tx.codPolicy.findUnique({ where: { countryId: input.countryId } });
      if (existing) {
        if (input.version !== existing.version) throw new ConflictException({ code: 'COD_POLICY_VERSION_CONFLICT', message: 'COD policy version conflict' });
        const updated = await tx.codPolicy.update({ where: { id: existing.id }, data: { enabled: input.enabled, maxOrderMinor: BigInt(input.maxOrderMinor), version: { increment: 1 }, updatedByUserId: ctx.userId } });
        await this.audit(tx, ctx.userId, 'finance.cod.policy.updated', 'CodPolicy', updated.id, input.countryId);
        return { policyId: updated.id, countryId: updated.countryId, enabled: updated.enabled, maxOrderMinor: updated.maxOrderMinor.toString(), version: updated.version };
      }
      const created = await tx.codPolicy.create({ data: { countryId: input.countryId, enabled: input.enabled, maxOrderMinor: BigInt(input.maxOrderMinor), createdByUserId: ctx.userId, updatedByUserId: ctx.userId } });
      await this.audit(tx, ctx.userId, 'finance.cod.policy.created', 'CodPolicy', created.id, input.countryId);
      return { policyId: created.id, countryId: created.countryId, enabled: created.enabled, maxOrderMinor: created.maxOrderMinor.toString(), version: created.version };
    });
  }
}
