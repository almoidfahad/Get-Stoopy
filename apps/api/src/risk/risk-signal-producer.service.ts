import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import {
  evaluateRisk, RISK_SIGNAL_WEIGHTS, RISK_PRODUCER_POLICY_VERSION,
  RISK_ORDER_VELOCITY_WINDOW_MINUTES, RISK_ORDER_VELOCITY_MIN_ORDERS,
  RISK_PAYMENT_FAILED_WINDOW_MINUTES, RISK_PAYMENT_FAILED_MIN_ORDERS,
  RISK_OTP_INVALID_WINDOW_MINUTES, RISK_OTP_MIN_INVALID_ATTEMPTS,
  riskProducerCaseKey, riskProducerWindowStart,
  type RiskSignalCode
} from '@getstoopy/core';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

interface Observation {
  kind: 'ORDER_ABUSE' | 'PAYMENT_ABUSE' | 'ACCOUNT_ABUSE';
  code: RiskSignalCode;
  countryId: string;
  subjectUserId: string;
  orderId?: string | null;
  occurredAt: Date;
  sourceType: 'ORDER' | 'PAYMENT_INTENT' | 'DELIVERY_OTP_ATTEMPT';
  sourceIds: string[];
  windowMinutes: number;
  threshold: number;
  observedCount: number;
}

/**
 * Internal, transaction-bound evidence producers. No HTTP controller exposes this service.
 * It reads already-persisted source facts, derives subject/country server-side, and only
 * appends risk evidence. It never returns a decision to the caller and never changes an
 * order, payment, OTP challenge, account, permission or ledger.
 */
@Injectable()
export class RiskSignalProducerService {
  constructor(@Inject(ENV) private readonly env: ApiEnv) {}

  async orderCreated(tx: any, orderId: string): Promise<void> {
    if (!this.env.RISK_SIGNAL_PRODUCERS_ENABLED) return;
    const rows = await tx.$queryRaw`SELECT * FROM "Order" WHERE id=${orderId}::uuid`;
    const order = (rows as any[])[0];
    if (!order) return;
    const occurredAt = new Date(order.createdAt);
    await this.lockProducer(tx, riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId: order.countryId, subjectUserId: order.buyerId, occurredAt }));
    const since = riskProducerWindowStart(occurredAt, RISK_ORDER_VELOCITY_WINDOW_MINUTES);
    const recent = await tx.$queryRaw`
      SELECT id FROM "Order"
      WHERE "buyerId"=${order.buyerId}::uuid AND "countryId"=${order.countryId}::uuid
        AND "createdAt" > ${since} AND "createdAt" <= ${occurredAt}
      ORDER BY id`;
    const ids = (recent as any[]).map(r => r.id as string);
    if (ids.length < RISK_ORDER_VELOCITY_MIN_ORDERS) return;
    await this.record(tx, {
      kind: 'ORDER_ABUSE', code: 'VELOCITY_ORDERS_HIGH', countryId: order.countryId,
      subjectUserId: order.buyerId, orderId: order.id, occurredAt, sourceType: 'ORDER',
      sourceIds: ids, windowMinutes: RISK_ORDER_VELOCITY_WINDOW_MINUTES,
      threshold: RISK_ORDER_VELOCITY_MIN_ORDERS, observedCount: ids.length
    });
  }

  async paymentFailed(tx: any, intentId: string): Promise<void> {
    if (!this.env.RISK_SIGNAL_PRODUCERS_ENABLED) return;
    const rows = await tx.$queryRaw`
      SELECT pi.*, o."countryId" FROM "PaymentIntent" pi
      JOIN "Order" o ON o.id=pi."orderId" WHERE pi.id=${intentId}::uuid`;
    const intent = (rows as any[])[0];
    if (!intent || intent.status !== 'FAILED' || !intent.closedAt) return;
    const occurredAt = new Date(intent.closedAt);
    await this.lockProducer(tx, riskProducerCaseKey({ kind: 'PAYMENT_ABUSE', countryId: intent.countryId, subjectUserId: intent.userId, occurredAt }));
    const since = riskProducerWindowStart(occurredAt, RISK_PAYMENT_FAILED_WINDOW_MINUTES);
    const recent = await tx.$queryRaw`
      SELECT pi.id, pi."orderId" FROM "PaymentIntent" pi
      JOIN "Order" o ON o.id=pi."orderId"
      WHERE pi."userId"=${intent.userId}::uuid AND o."countryId"=${intent.countryId}::uuid
        AND pi.status='FAILED' AND pi."closedAt" > ${since} AND pi."closedAt" <= ${occurredAt}
      ORDER BY pi.id`;
    const list = recent as any[];
    const distinctOrders = new Set(list.map(r => r.orderId));
    if (distinctOrders.size < RISK_PAYMENT_FAILED_MIN_ORDERS) return;
    await this.record(tx, {
      kind: 'PAYMENT_ABUSE', code: 'PAYMENT_FAILED_BURST', countryId: intent.countryId,
      subjectUserId: intent.userId, orderId: intent.orderId, occurredAt,
      sourceType: 'PAYMENT_INTENT', sourceIds: list.map(r => r.id),
      windowMinutes: RISK_PAYMENT_FAILED_WINDOW_MINUTES, threshold: RISK_PAYMENT_FAILED_MIN_ORDERS,
      observedCount: distinctOrders.size
    });
  }

  async otpInvalidAttempt(tx: any, attemptId: string): Promise<void> {
    if (!this.env.RISK_SIGNAL_PRODUCERS_ENABLED) return;
    const rows = await tx.$queryRaw`
      SELECT a.*, d."countryId" FROM "DeliveryOtpAttempt" a
      JOIN "DeliveryOtpChallenge" c ON c.id=a."challengeId"
      JOIN "Delivery" d ON d.id=c."deliveryId" WHERE a.id=${attemptId}::uuid`;
    const attempt = (rows as any[])[0];
    // Only actual wrong-code submissions count. Locked/expired replays and valid OTPs do not.
    if (!attempt || attempt.outcome !== 'INVALID') return;
    const occurredAt = new Date(attempt.occurredAt);
    await this.lockProducer(tx, riskProducerCaseKey({ kind: 'ACCOUNT_ABUSE', countryId: attempt.countryId, subjectUserId: attempt.actorUserId, occurredAt }));
    const since = riskProducerWindowStart(occurredAt, RISK_OTP_INVALID_WINDOW_MINUTES);
    const recent = await tx.$queryRaw`
      SELECT a.id FROM "DeliveryOtpAttempt" a
      JOIN "DeliveryOtpChallenge" c ON c.id=a."challengeId"
      JOIN "Delivery" d ON d.id=c."deliveryId"
      WHERE a."actorUserId"=${attempt.actorUserId}::uuid AND d."countryId"=${attempt.countryId}::uuid
        AND a.outcome='INVALID' AND a."occurredAt" > ${since} AND a."occurredAt" <= ${occurredAt}
      ORDER BY a.id`;
    const ids = (recent as any[]).map(r => r.id as string);
    if (ids.length < RISK_OTP_MIN_INVALID_ATTEMPTS) return;
    await this.record(tx, {
      kind: 'ACCOUNT_ABUSE', code: 'OTP_ABUSE_PATTERN', countryId: attempt.countryId,
      subjectUserId: attempt.actorUserId, orderId: null, occurredAt,
      sourceType: 'DELIVERY_OTP_ATTEMPT', sourceIds: ids,
      windowMinutes: RISK_OTP_INVALID_WINDOW_MINUTES, threshold: RISK_OTP_MIN_INVALID_ATTEMPTS,
      observedCount: ids.length
    });
  }

  /** Serialize a subject/country/kind/UTC-day before counting, so concurrent threshold crossings are not missed. */
  private async lockProducer(tx: any, producerKey: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${producerKey}))`;
  }

  private async record(tx: any, observation: Observation): Promise<void> {
    const producerKey = riskProducerCaseKey(observation);
    await this.lockProducer(tx, producerKey);
    const existing = await tx.riskCase.findUnique({ where: { producerKey } });
    if (existing && ['CLEARED', 'CONFIRMED_FRAUD'].includes(existing.status)) return;

    const sourceIds = [...new Set(observation.sourceIds)].sort();
    if (!sourceIds.length) return;
    const summary = {
      producerPolicyVersion: RISK_PRODUCER_POLICY_VERSION,
      sourceType: observation.sourceType,
      windowMinutes: observation.windowMinutes,
      threshold: observation.threshold,
      observedCount: observation.observedCount,
      automatedEnforcement: false
    };
    const evidenceHash = hash({ code: observation.code, sourceIds, summary });
    const weight = RISK_SIGNAL_WEIGHTS[observation.code];
    let caseId: string;
    let version: number;
    let score: number;
    let band: string;
    let opened = false;

    if (!existing) {
      const evaluation = evaluateRisk([observation.code]);
      const created = await tx.riskCase.create({ data: {
        countryId: observation.countryId, subjectUserId: observation.subjectUserId,
        orderId: observation.orderId ?? null, kind: observation.kind,
        policyVersion: evaluation.policyVersion, producerKey,
        score: evaluation.score, band: evaluation.band, openedByUserId: null
      } });
      caseId = created.id; version = created.version; score = created.score; band = created.band; opened = true;
    } else {
      const prior = await tx.riskSignal.findUnique({ where: { caseId_code: { caseId: existing.id, code: observation.code } } });
      if (prior) return;
      const signals = await tx.riskSignal.findMany({ where: { caseId: existing.id }, select: { code: true } });
      const evaluation = evaluateRisk([...signals.map((s: any) => s.code), observation.code]);
      const updated = await tx.riskCase.update({ where: { id: existing.id }, data: {
        score: evaluation.score, band: evaluation.band, version: { increment: 1 }
      } });
      caseId = updated.id; version = updated.version; score = updated.score; band = updated.band;
    }

    await tx.riskSignal.create({ data: {
      caseId, code: observation.code, weight, evidenceHash, summary, observedAt: observation.occurredAt
    } });
    const eventKey = `risk-signal-${caseId}-${observation.code}`;
    const occurredAt = observation.occurredAt;
    await tx.$executeRaw`
      INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","afterRedacted","requestId")
      VALUES(gen_random_uuid(),'SYSTEM',${opened ? 'risk.case.opened' : 'risk.signal.recorded'},'RiskCase',${caseId}::uuid,
        ${JSON.stringify({ countryId: observation.countryId, code: observation.code })}::jsonb,
        ${JSON.stringify(summary)}::jsonb,gen_random_uuid())`;
    await tx.outboxEvent.create({ data: {
      aggregateType: 'RiskCase', aggregateId: caseId, eventKey,
      eventType: 'risk.signal.recorded', occurredAt,
      payload: { schemaVersion: 1, eventKey, eventType: 'risk.signal.recorded',
        occurredAt: occurredAt.toISOString(), aggregateType: 'RiskCase', aggregateId: caseId,
        countryId: observation.countryId,
        data: { code: observation.code, version, score, band, summary, automatedEnforcement: false } }
    } });
  }
}
