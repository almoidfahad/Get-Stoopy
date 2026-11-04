import { describe, expect, it } from 'vitest';
import {
  RISK_HIGH_THRESHOLD,
  RISK_POLICY_VERSION,
  RISK_REVIEW_THRESHOLD,
  RISK_SCORE_CAP,
  RISK_SIGNAL_WEIGHTS,
  assertIndependentRiskReview,
  evaluateRisk,
  isRiskSignalCode,
  riskBand
} from '../src/fraud-risk.js';

describe('deterministic fraud-risk policy', () => {
  it('keeps an empty observation permissive and never enforces automatically', () => {
    const result = evaluateRisk([]);
    expect(result.score).toBe(0);
    expect(result.band).toBe('LOW');
    expect(result.recommendation).toBe('ALLOW');
    expect(result.automatedEnforcement).toBe(false);
    expect(result.policyVersion).toBe(RISK_POLICY_VERSION);
  });

  it('never queues a customer for review on a VPN/proxy signal alone', () => {
    const result = evaluateRisk(['VPN_OR_PROXY_ONLY']);
    expect(result.weakOnly).toBe(true);
    expect(result.score).toBeLessThan(RISK_REVIEW_THRESHOLD);
    expect(result.band).toBe('LOW');
    expect(result.recommendation).toBe('ALLOW');

    const combinedWeak = evaluateRisk(['VPN_OR_PROXY_ONLY', 'LOCATION_SPOOF_SUSPECTED', 'VPN_OR_PROXY_ONLY']);
    expect(combinedWeak.weakOnly).toBe(true);
    expect(combinedWeak.recommendation).toBe('ALLOW');
  });

  it('counts repeated evidence once so a noisy producer cannot inflate a score', () => {
    const once = evaluateRisk(['VELOCITY_ORDERS_HIGH']);
    const many = evaluateRisk(Array.from({ length: 20 }, () => 'VELOCITY_ORDERS_HIGH'));
    expect(many.score).toBe(once.score);
    expect(many.countedCodes).toEqual(['VELOCITY_ORDERS_HIGH']);
  });

  it('routes strong evidence to a human instead of blocking automatically', () => {
    const result = evaluateRisk(['CONFIRMED_FAKE_ORDER_EVIDENCE', 'COUPON_ABUSE_PATTERN']);
    expect(result.score).toBeGreaterThanOrEqual(RISK_HIGH_THRESHOLD);
    expect(result.band).toBe('HIGH');
    expect(result.recommendation).toBe('MANUAL_REVIEW');
    expect(result.automatedEnforcement).toBe(false);
  });

  it('caps the score and rejects unknown signals rather than guessing', () => {
    const all = Object.keys(RISK_SIGNAL_WEIGHTS);
    const result = evaluateRisk(all);
    expect(result.score).toBeLessThanOrEqual(RISK_SCORE_CAP);
    expect(() => evaluateRisk(['MADE_UP_SIGNAL'])).toThrow('RISK_SIGNAL_UNKNOWN');
    expect(isRiskSignalCode('MADE_UP_SIGNAL')).toBe(false);
    expect(isRiskSignalCode('VELOCITY_ORDERS_HIGH')).toBe(true);
  });

  it('exposes stable band boundaries and rejects malformed scores', () => {
    expect(riskBand(RISK_REVIEW_THRESHOLD - 1)).toBe('LOW');
    expect(riskBand(RISK_REVIEW_THRESHOLD)).toBe('REVIEW');
    expect(riskBand(RISK_HIGH_THRESHOLD - 1)).toBe('REVIEW');
    expect(riskBand(RISK_HIGH_THRESHOLD)).toBe('HIGH');
    expect(riskBand(RISK_SCORE_CAP)).toBe('HIGH');
    for (const bad of [-1, 101, 1.5, Number.NaN]) expect(() => riskBand(bad)).toThrow('RISK_SCORE_INVALID');
  });

  it('requires an independent, explained human review', () => {
    const base = { decision: 'CLEAR' as const, reviewerUserId: 'reviewer', openedByUserId: null, subjectUserId: 'subject', reason: 'Evidence does not support the signal' };
    expect(() => assertIndependentRiskReview(base)).not.toThrow();
    expect(() => assertIndependentRiskReview({ ...base, openedByUserId: 'opener' })).not.toThrow();
    expect(() => assertIndependentRiskReview({ ...base, openedByUserId: 'reviewer' })).toThrow('RISK_REVIEW_NOT_INDEPENDENT');
    expect(() => assertIndependentRiskReview({ ...base, subjectUserId: 'reviewer' })).toThrow('RISK_SELF_REVIEW_DENIED');
    expect(() => assertIndependentRiskReview({ ...base, reason: 'short' })).toThrow('RISK_REVIEW_REASON_INVALID');
    expect(() => assertIndependentRiskReview({ ...base, reason: 'x'.repeat(513) })).toThrow('RISK_REVIEW_REASON_INVALID');
    expect(() => assertIndependentRiskReview({ ...base, reviewerUserId: '' })).toThrow('RISK_REVIEWER_REQUIRED');
    expect(() => assertIndependentRiskReview({ ...base, decision: 'BAN' as never })).toThrow('RISK_DECISION_INVALID');
  });
});
