import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { decryptJson, encryptJson } from '@getstoopy/bff';
import { assertDeliveryCommandKey, deliveryCompletionGate, deliveryOtpHash, generateDeliveryOtp, maskPhone, normalizeRecipientPhone, recipientPhoneHash, verifyDeliveryOtp, type AccessContext } from '@getstoopy/core';
import { DELIVERY_OTP_CHANNEL, type DeliveryOtpChannel } from './delivery-otp.channel.js';
import { FinanceService } from '../finance/finance.service.js';

function hashPayload(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function commandKey(key: string): void { try { assertDeliveryCommandKey(key); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'DELIVERY_COMMAND_KEY_INVALID', message: 'Invalid delivery command key' }); } }

@Injectable()
export class DeliveryService {
  constructor(@Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv, @Inject(DELIVERY_OTP_CHANNEL) private readonly otpChannel: DeliveryOtpChannel, @Inject(FinanceService) private readonly finance: FinanceService) {}

  private keys(): { pepper: string; encryptionKey: string } {
    if (!this.env.DELIVERY_OTP_PEPPER || !this.env.DELIVERY_RECIPIENT_ENCRYPTION_KEY) throw new ServiceUnavailableException({ code: 'DELIVERY_OTP_KEYS_REQUIRED', message: 'Delivery OTP keys are not configured' });
    return { pepper: this.env.DELIVERY_OTP_PEPPER, encryptionKey: this.env.DELIVERY_RECIPIENT_ENCRYPTION_KEY };
  }
  private requireRider(ctx: AccessContext): string { if (!ctx.riderId) throw new ForbiddenException({ code: 'RIDER_KYC_REQUIRED', message: 'Active KYC-eligible rider profile is required' }); return ctx.riderId; }
  private async audit(tx: any, ctx: AccessContext, action: string, resourceId: string, countryId: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, 'Delivery', ${resourceId}::uuid, ${JSON.stringify({ countryId })}::jsonb, ${randomUUID()}::uuid)`;
  }
  private async outbox(tx: any, deliveryId: string, eventType: string, eventKey: string, countryId: string, data: Record<string, unknown>) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({ data: { aggregateType: 'Delivery', aggregateId: deliveryId, eventKey, eventType, occurredAt, payload: { schemaVersion: 1, eventKey, eventType, occurredAt: occurredAt.toISOString(), aggregateType: 'Delivery', aggregateId: deliveryId, countryId, data } } });
  }
  private async event(tx: any, deliveryId: string, eventType: string, ctx: AccessContext, key: string, payload: unknown) {
    await tx.deliveryEvent.create({ data: { deliveryId, eventType, actorUserId: ctx.userId, commandKey: key, payloadHash: hashPayload(payload) } });
  }
  private async lockAssignment(tx: any, assignmentId: string) {
    const rows = await tx.$queryRaw`SELECT a."id", a."riderId", a."suborderId", a."countryId", a."status", s."orderId", s."status" AS "suborderStatus", s."version" AS "suborderVersion", o."paymentMethod", o."paymentStatus" FROM "RiderAssignment" a JOIN "VendorSuborder" s ON s."id"=a."suborderId" JOIN "Order" o ON o."id"=s."orderId" WHERE a."id"=${assignmentId}::uuid FOR UPDATE OF a`;
    const assignment = (rows as any[])[0];
    if (!assignment) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' });
    return assignment;
  }
  private async lockDelivery(tx: any, deliveryId: string) {
    const locked = await tx.$queryRaw`SELECT "id" FROM "Delivery" WHERE "id"=${deliveryId}::uuid FOR UPDATE`;
    if (!(locked as any[])[0]) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    return tx.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  }
  private async suborderTransition(tx: any, ctx: AccessContext, suborderId: string, from: string, to: string, expectedVersion: number, key: string, payload: unknown) {
    const updated = await tx.vendorSuborder.update({ where: { id: suborderId }, data: { status: to as any, version: { increment: 1 } } });
    await tx.vendorSuborderStatusEvent.create({ data: { suborderId, fromStatus: from as any, toStatus: to as any, suborderVersion: updated.version, actorUserId: ctx.userId, commandKey: key, payloadHash: hashPayload(payload) } });
    return updated;
  }

  async setRecipient(ctx: AccessContext, orderId: string, input: { name: string; phone: string; commandKey: string }) {
    commandKey(input.commandKey);
    const { pepper, encryptionKey } = this.keys();
    const name = input.name?.trim();
    if (!name || name.length < 2 || name.length > 120) throw new BadRequestException({ code: 'RECIPIENT_NAME_INVALID', message: 'Recipient name is invalid' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const order = await tx.order.findFirst({ where: { id: orderId, buyerId: ctx.userId }, include: { country: true } });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      let phone: string;
      try { phone = normalizeRecipientPhone(input.phone, order.country.callingCode); } catch (e: any) { throw new BadRequestException({ code: e.message ?? 'RECIPIENT_PHONE_INVALID', message: 'Recipient phone is invalid' }); }
      const phoneHash = recipientPhoneHash(pepper, phone);
      const payloadHash = hashPayload({ name, phoneHash });
      const existing = await tx.deliveryRecipient.findUnique({ where: { orderId } });
      if (existing) {
        if (existing.commandKey !== input.commandKey || existing.payloadHash !== payloadHash) throw new ConflictException({ code: 'RECIPIENT_ALREADY_SET', message: 'Recipient contact is immutable once set' });
        return { recipientId: existing.id, orderId, maskedPhone: maskPhone(phone), duplicate: true };
      }
      const contactEnvelope = Buffer.from(encryptJson({ name, phoneE164: phone }, encryptionKey));
      const recipient = await tx.deliveryRecipient.create({ data: { orderId, countryId: order.countryId, contactEnvelope, phoneHash, commandKey: input.commandKey, payloadHash, setByUserId: ctx.userId } });
      await this.audit(tx, ctx, 'commerce.order.recipient_set', recipient.id, order.countryId);
      await this.outbox(tx, recipient.id, 'commerce.order.recipient_set', `order-recipient-${orderId}`, order.countryId, { orderId, recipientId: recipient.id });
      return { recipientId: recipient.id, orderId, maskedPhone: maskPhone(phone), duplicate: false };
    });
  }

  async confirmPickup(ctx: AccessContext, assignmentId: string, input: { commandKey: string }) {
    const riderId = this.requireRider(ctx); commandKey(input.commandKey);
    const payloadHash = hashPayload({ assignmentId });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const assignment = await this.lockAssignment(tx, assignmentId);
      if (assignment.riderId !== riderId) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' });
      const existing = await tx.delivery.findUnique({ where: { assignmentId } });
      if (existing) {
        if (existing.pickupCommandKey !== input.commandKey || existing.pickupPayloadHash !== payloadHash) throw new ConflictException({ code: 'PICKUP_ALREADY_CONFIRMED', message: 'Pickup already confirmed with different command' });
        return { deliveryId: existing.id, assignmentId, status: existing.status, version: existing.version, duplicate: true };
      }
      if (assignment.status !== 'ACTIVE' || assignment.suborderStatus !== 'READY_FOR_PICKUP') throw new ConflictException({ code: 'PICKUP_NOT_READY', message: 'Assignment/suborder is not ready for pickup' });
      const recipient = await tx.deliveryRecipient.findUnique({ where: { orderId: assignment.orderId } });
      if (!recipient) throw new ConflictException({ code: 'RECIPIENT_REQUIRED', message: 'Buyer must set recipient contact before pickup' });
      const delivery = await tx.delivery.create({ data: { assignmentId, suborderId: assignment.suborderId, riderId, countryId: assignment.countryId, recipientId: recipient.id, pickupConfirmedAt: new Date(), pickupCommandKey: input.commandKey, pickupPayloadHash: payloadHash } });
      await this.suborderTransition(tx, ctx, assignment.suborderId, 'READY_FOR_PICKUP', 'FULFILLING', assignment.suborderVersion, `d-${hashPayload({ action: 'pickup', key: input.commandKey }).slice(0, 48)}`, { deliveryId: delivery.id });
      await this.event(tx, delivery.id, 'delivery.pickup.confirmed', ctx, input.commandKey, { assignmentId });
      await this.audit(tx, ctx, 'delivery.pickup.confirmed', delivery.id, assignment.countryId);
      await this.outbox(tx, delivery.id, 'delivery.pickup.confirmed', `delivery-pickup-${delivery.id}`, assignment.countryId, { assignmentId, suborderId: assignment.suborderId });
      return { deliveryId: delivery.id, assignmentId, status: delivery.status, version: delivery.version, duplicate: false };
    });
  }

  async issueOtp(ctx: AccessContext, deliveryId: string, input: { commandKey: string }) {
    const riderId = this.requireRider(ctx); commandKey(input.commandKey);
    if (!this.env.DELIVERY_OTP_ENABLED) throw new ServiceUnavailableException({ code: 'DELIVERY_OTP_DISABLED', message: 'Delivery OTP channel is not enabled' });
    const { pepper, encryptionKey } = this.keys();
    const payloadHash = hashPayload({ deliveryId });
    let testCode: { challengeId: string; phoneE164: string; code: string; expiresAt: Date } | null = null;
    const result = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const delivery = await this.lockDelivery(tx, deliveryId);
      if (delivery.riderId !== riderId) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
      if (delivery.status !== 'PICKED_UP') throw new ConflictException({ code: 'OTP_NOT_ALLOWED', message: 'OTP is allowed only after pickup and before delivery proof' });
      const existingCommand = await tx.deliveryOtpChallenge.findUnique({ where: { deliveryId_commandKey: { deliveryId, commandKey: input.commandKey } } });
      if (existingCommand) {
        if (existingCommand.payloadHash !== payloadHash) throw new ConflictException({ code: 'DELIVERY_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { challengeId: existingCommand.id, status: existingCommand.status, expiresAt: existingCommand.expiresAt, sequence: existingCommand.sequence, duplicate: true };
      }
      const open = await tx.deliveryOtpChallenge.findFirst({ where: { deliveryId, status: 'ISSUED' } });
      const nowRows = await tx.$queryRaw`SELECT gs_dispatch_now() AS now`;
      const now = new Date((nowRows as any[])[0].now);
      if (open && open.expiresAt > now) throw new ConflictException({ code: 'OTP_ALREADY_ISSUED', message: 'An unexpired OTP challenge already exists' });
      const count = await tx.deliveryOtpChallenge.count({ where: { deliveryId } });
      if (count >= this.env.DELIVERY_OTP_MAX_ISSUES) throw new ConflictException({ code: 'OTP_ISSUE_LIMIT', message: 'Maximum OTP issues reached for this delivery' });
      const latest = await tx.deliveryOtpChallenge.findFirst({ where: { deliveryId }, orderBy: { sequence: 'desc' } });
      if (latest && now.getTime() - latest.issuedAt.getTime() < this.env.DELIVERY_OTP_RESEND_COOLDOWN_SECONDS * 1000) throw new ConflictException({ code: 'OTP_RESEND_COOLDOWN', message: 'OTP resend cooldown is active' });
      const recentRecipientIssues = await tx.deliveryOtpChallenge.count({ where: { recipientId: delivery.recipientId, issuedAt: { gt: new Date(now.getTime() - 3600_000) } } });
      if (recentRecipientIssues >= 5) throw new ConflictException({ code: 'OTP_RECIPIENT_RATE_LIMIT', message: 'Too many OTP issues for this recipient' });
      if (open) await tx.deliveryOtpChallenge.update({ where: { id: open.id }, data: { status: 'EXPIRED', closedAt: now } });
      const recipient = await tx.deliveryRecipient.findUniqueOrThrow({ where: { id: delivery.recipientId } });
      const contact = decryptJson<{ name: string; phoneE164: string }>(Buffer.from(recipient.contactEnvelope).toString('utf8'), encryptionKey);
      const challengeId = randomUUID(); const code = generateDeliveryOtp();
      const expiresAt = new Date(now.getTime() + this.env.DELIVERY_OTP_TTL_SECONDS * 1000);
      const challenge = await tx.deliveryOtpChallenge.create({ data: { id: challengeId, deliveryId, recipientId: delivery.recipientId, sequence: count + 1, codeHash: deliveryOtpHash(pepper, challengeId, code), maxAttempts: this.env.DELIVERY_OTP_MAX_ATTEMPTS, channel: this.otpChannel.channel, commandKey: input.commandKey, payloadHash, issuedAt: now, expiresAt } });
      testCode = { challengeId, phoneE164: contact.phoneE164, code, expiresAt };
      await this.event(tx, deliveryId, 'delivery.otp.issued', ctx, input.commandKey, { challengeId, sequence: challenge.sequence, maskedPhone: maskPhone(contact.phoneE164) });
      await this.audit(tx, ctx, 'delivery.otp.issued', deliveryId, delivery.countryId);
      await this.outbox(tx, deliveryId, 'delivery.otp.issued', `delivery-otp-issued-${challengeId}`, delivery.countryId, { challengeId, sequence: challenge.sequence, expiresAt: expiresAt.toISOString() });
      return { challengeId, status: challenge.status, expiresAt, sequence: challenge.sequence, maskedPhone: maskPhone(contact.phoneE164), duplicate: false };
    });
    if (testCode) {
      try { await this.otpChannel.send(testCode); } catch { throw new ServiceUnavailableException({ code: 'DELIVERY_OTP_CHANNEL_DISABLED', message: 'Delivery OTP channel is unavailable' }); }
    }
    return result;
  }

  async verifyOtp(ctx: AccessContext, deliveryId: string, challengeId: string, input: { code: string; commandKey: string }) {
    const riderId = this.requireRider(ctx); commandKey(input.commandKey);
    if (!/^[0-9]{6}$/.test(input.code)) throw new BadRequestException({ code: 'OTP_FORMAT_INVALID', message: 'OTP must be six digits' });
    const { pepper } = this.keys();
    const payloadHash = deliveryOtpHash(pepper, challengeId, input.code);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const delivery = await this.lockDelivery(tx, deliveryId);
      if (delivery.riderId !== riderId) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
      const challengeRows = await tx.$queryRaw`SELECT * FROM "DeliveryOtpChallenge" WHERE "id"=${challengeId}::uuid AND "deliveryId"=${deliveryId}::uuid FOR UPDATE`;
      const challenge = (challengeRows as any[])[0];
      if (!challenge) throw new NotFoundException({ code: 'CHALLENGE_NOT_FOUND', message: 'OTP challenge not found' });
      const existingAttempt = await tx.deliveryOtpAttempt.findUnique({ where: { challengeId_commandKey: { challengeId, commandKey: input.commandKey } } });
      if (existingAttempt) {
        if (existingAttempt.payloadHash !== payloadHash) throw new ConflictException({ code: 'DELIVERY_IDEMPOTENCY_CONFLICT', message: 'Command key already used with different payload' });
        return { deliveryId, challengeId, outcome: existingAttempt.outcome, duplicate: true };
      }
      const recentAttempts = await tx.deliveryOtpAttempt.count({ where: { actorUserId: ctx.userId, occurredAt: { gt: new Date(Date.now() - 60_000) } } });
      if (recentAttempts >= 10) throw new ConflictException({ code: 'OTP_RATE_LIMIT', message: 'Too many OTP attempts' });
      const nowRows = await tx.$queryRaw`SELECT gs_dispatch_now() AS now`;
      const now = new Date((nowRows as any[])[0].now);
      if (challenge.status !== 'ISSUED') {
        await tx.deliveryOtpAttempt.create({ data: { challengeId, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, outcome: 'LOCKED' } });
        return { deliveryId, challengeId, outcome: 'LOCKED', duplicate: false };
      }
      if (now >= challenge.expiresAt) {
        await tx.deliveryOtpChallenge.update({ where: { id: challengeId }, data: { status: 'EXPIRED', closedAt: now } });
        await tx.deliveryOtpAttempt.create({ data: { challengeId, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, outcome: 'EXPIRED' } });
        return { deliveryId, challengeId, outcome: 'EXPIRED', duplicate: false };
      }
      const valid = verifyDeliveryOtp(pepper, challengeId, input.code, challenge.codeHash);
      const attempts = challenge.attempts + 1;
      if (!valid) {
        const locked = attempts >= challenge.maxAttempts;
        await tx.deliveryOtpChallenge.update({ where: { id: challengeId }, data: { attempts, ...(locked ? { status: 'LOCKED', closedAt: now } : {}) } });
        await tx.deliveryOtpAttempt.create({ data: { challengeId, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, outcome: locked ? 'LOCKED' : 'INVALID' } });
        return { deliveryId, challengeId, outcome: locked ? 'LOCKED' : 'INVALID', attemptsRemaining: Math.max(0, challenge.maxAttempts - attempts), duplicate: false };
      }
      await tx.deliveryOtpChallenge.update({ where: { id: challengeId }, data: { status: 'VERIFIED', attempts, verifiedAt: now, closedAt: now } });
      await tx.deliveryOtpAttempt.create({ data: { challengeId, actorUserId: ctx.userId, commandKey: input.commandKey, payloadHash, outcome: 'VALID' } });
      const proof = await tx.deliveryProof.create({ data: { deliveryId, challengeId, verifiedByUserId: ctx.userId, verifiedAt: now, evidenceHash: hashPayload({ deliveryId, challengeId, challengeHash: challenge.codeHash }) } });
      await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'DELIVERED', deliveredAt: now, version: { increment: 1 } } });
      const suborder = await tx.vendorSuborder.findUniqueOrThrow({ where: { id: delivery.suborderId } });
      await this.suborderTransition(tx, ctx, delivery.suborderId, 'FULFILLING', 'DELIVERED', suborder.version, `d-${hashPayload({ action: 'otp', key: input.commandKey }).slice(0, 48)}`, { proofId: proof.id });
      await this.event(tx, deliveryId, 'delivery.otp.verified', ctx, input.commandKey, { challengeId, proofId: proof.id });
      await this.audit(tx, ctx, 'delivery.otp.verified', deliveryId, delivery.countryId);
      await this.outbox(tx, deliveryId, 'delivery.otp.verified', `delivery-otp-verified-${proof.id}`, delivery.countryId, { challengeId, proofId: proof.id });
      return { deliveryId, challengeId, proofId: proof.id, outcome: 'VALID', duplicate: false };
    });
  }

  async complete(ctx: AccessContext, deliveryId: string, input: { expectedVersion: number; commandKey: string }) {
    const riderId = this.requireRider(ctx); commandKey(input.commandKey);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'Invalid delivery version' });
    const payloadHash = hashPayload({ expectedVersion: input.expectedVersion });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const delivery = await this.lockDelivery(tx, deliveryId);
      if (delivery.riderId !== riderId) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
      if (delivery.status === 'COMPLETED') {
        if (delivery.completionCommandKey !== input.commandKey || delivery.completionPayloadHash !== payloadHash) throw new ConflictException({ code: 'DELIVERY_IDEMPOTENCY_CONFLICT', message: 'Delivery already completed with different command' });
        return { deliveryId, status: delivery.status, version: delivery.version, duplicate: true };
      }
      if (delivery.version !== input.expectedVersion) throw new ConflictException({ code: 'DELIVERY_VERSION_CONFLICT', message: 'Delivery version conflict' });
      const proof = await tx.deliveryProof.findUnique({ where: { deliveryId } });
      const assignment = await tx.riderAssignment.findUniqueOrThrow({ where: { id: delivery.assignmentId } });
      const suborder = await tx.vendorSuborder.findUniqueOrThrow({ where: { id: delivery.suborderId }, include: { order: true } });
      const gate = deliveryCompletionGate({ deliveryStatus: delivery.status, proofVerified: !!proof, paymentMethod: suborder.order.paymentMethod, paymentStatus: suborder.order.paymentStatus, codAccountingVerified: suborder.order.paymentMethod === 'COD' });
      if (gate) throw new ConflictException({ code: gate, message: 'Delivery completion gate is not satisfied' });
      const now = new Date();
      const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'COMPLETED', completedAt: now, completionCommandKey: input.commandKey, completionPayloadHash: payloadHash, version: { increment: 1 } } });
      await tx.riderAssignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED' } });
      await this.suborderTransition(tx, ctx, delivery.suborderId, 'DELIVERED', 'COMPLETED', suborder.version, `d-${hashPayload({ action: 'complete', key: input.commandKey }).slice(0, 48)}`, { deliveryId });
      await this.finance.recordCompletionTx(tx, { id: deliveryId, assignmentId: assignment.id, riderId: delivery.riderId, countryId: delivery.countryId }, ctx.userId);
      await this.event(tx, deliveryId, 'delivery.completed', ctx, input.commandKey, { assignmentId: assignment.id });
      await this.audit(tx, ctx, 'delivery.completed', deliveryId, delivery.countryId);
      await this.outbox(tx, deliveryId, 'delivery.completed', `delivery-completed-${deliveryId}`, delivery.countryId, { assignmentId: assignment.id, suborderId: delivery.suborderId });
      return { deliveryId, status: updated.status, version: updated.version, duplicate: false };
    });
  }

  async get(ctx: AccessContext, deliveryId: string) {
    const riderId = this.requireRider(ctx);
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, include: { proof: true, recipient: true } });
      if (!delivery || delivery.riderId !== riderId) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
      let maskedPhone: string | null = null;
      if (this.env.DELIVERY_RECIPIENT_ENCRYPTION_KEY) {
        try { const contact = decryptJson<{ phoneE164: string }>(Buffer.from(delivery.recipient.contactEnvelope).toString('utf8'), this.env.DELIVERY_RECIPIENT_ENCRYPTION_KEY); maskedPhone = maskPhone(contact.phoneE164); } catch { maskedPhone = null; }
      }
      const challenges = await tx.deliveryOtpChallenge.findMany({ where: { deliveryId }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, status: true, attempts: true, maxAttempts: true, issuedAt: true, expiresAt: true, verifiedAt: true } });
      return { deliveryId: delivery.id, assignmentId: delivery.assignmentId, suborderId: delivery.suborderId, status: delivery.status, version: delivery.version, pickupConfirmedAt: delivery.pickupConfirmedAt, deliveredAt: delivery.deliveredAt, completedAt: delivery.completedAt, maskedPhone, proof: delivery.proof ? { proofId: delivery.proof.id, method: delivery.proof.method, verifiedAt: delivery.proof.verifiedAt } : null, otpChallenges: challenges };
    });
  }
}
