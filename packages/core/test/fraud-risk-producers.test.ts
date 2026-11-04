import { describe, expect, it } from 'vitest';
import {
  riskProducerCaseKey, riskProducerWindowStart,
  RISK_ORDER_VELOCITY_MIN_ORDERS, RISK_ORDER_VELOCITY_WINDOW_MINUTES,
  RISK_PAYMENT_FAILED_MIN_ORDERS, RISK_PAYMENT_FAILED_WINDOW_MINUTES,
  RISK_OTP_MIN_INVALID_ATTEMPTS, RISK_OTP_INVALID_WINDOW_MINUTES,
  RISK_PRODUCER_POLICY_VERSION, evaluateRisk
} from '../src/fraud-risk.js';

const countryId = '11111111-1111-4111-8111-111111111111';
const subjectUserId = '22222222-2222-4222-8222-222222222222';
const occurredAt = new Date('2026-11-04T18:30:00.000Z');

describe('fraud-risk producer policy helpers', () => {
  it('builds a stable UTC-day, country and subject scoped case key', () => {
    const key = riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId, subjectUserId, occurredAt });
    expect(key).toBe(`risk-v1:ORDER_ABUSE:${countryId}:${subjectUserId}:2026-11-04`);
    expect(key).toBe(riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId: countryId.toUpperCase(), subjectUserId, occurredAt: new Date('2026-11-04T23:59:59.999Z') }));
    expect(key).not.toBe(riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId, subjectUserId, occurredAt: new Date('2026-11-05T00:00:00.000Z') }));
    expect(key.length).toBeLessThanOrEqual(160);
  });

  it('rejects invalid scope or time instead of guessing', () => {
    expect(() => riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId: 'bd', subjectUserId, occurredAt })).toThrow('RISK_PRODUCER_SCOPE_INVALID');
    expect(() => riskProducerCaseKey({ kind: 'ORDER_ABUSE', countryId, subjectUserId, occurredAt: new Date('invalid') })).toThrow('RISK_PRODUCER_TIME_INVALID');
  });

  it('computes exclusive rolling window starts without mutating input', () => {
    const start = riskProducerWindowStart(occurredAt, 10);
    expect(start.toISOString()).toBe('2026-11-04T18:20:00.000Z');
    expect(occurredAt.toISOString()).toBe('2026-11-04T18:30:00.000Z');
    expect(() => riskProducerWindowStart(occurredAt, 0)).toThrow('RISK_PRODUCER_WINDOW_INVALID');
    expect(() => riskProducerWindowStart(occurredAt, 1441)).toThrow('RISK_PRODUCER_WINDOW_INVALID');
  });

  it('keeps conservative producer thresholds and never recommends enforcement', () => {
    expect(RISK_PRODUCER_POLICY_VERSION).toBe('risk-producers-v1');
    expect(RISK_ORDER_VELOCITY_WINDOW_MINUTES).toBe(10);
    expect(RISK_ORDER_VELOCITY_MIN_ORDERS).toBe(6);
    expect(RISK_PAYMENT_FAILED_WINDOW_MINUTES).toBe(15);
    expect(RISK_PAYMENT_FAILED_MIN_ORDERS).toBe(3);
    expect(RISK_OTP_INVALID_WINDOW_MINUTES).toBe(15);
    expect(RISK_OTP_MIN_INVALID_ATTEMPTS).toBe(4);
    for (const code of ['VELOCITY_ORDERS_HIGH', 'PAYMENT_FAILED_BURST', 'OTP_ABUSE_PATTERN'] as const) {
      const result = evaluateRisk([code]);
      expect(result.automatedEnforcement).toBe(false);
      expect(result.recommendation).toBe('ALLOW');
    }
  });
});
