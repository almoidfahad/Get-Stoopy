/**
 * Deterministic fraud-risk policy for the first manual-review slice.
 *
 * Safety contract (threat model T15/T16/T18):
 *  - Signals are evidence-based and weighted by a versioned, auditable table.
 *  - No score can trigger automated enforcement. HIGH still routes to a human.
 *  - A weak network signal (VPN/proxy) can never on its own justify a hold.
 *  - Nothing here approves refunds, payouts, KYC or permission changes.
 */
export const RISK_POLICY_VERSION = 'risk-v1';

export const RISK_SIGNAL_WEIGHTS = {
  VELOCITY_ORDERS_HIGH: 25,
  PAYMENT_FAILED_BURST: 20,
  ADDRESS_MISMATCH_REPEATED: 20,
  COUPON_ABUSE_PATTERN: 25,
  DEVICE_SHARED_ACROSS_ACCOUNTS: 15,
  OTP_ABUSE_PATTERN: 25,
  CONFIRMED_FAKE_ORDER_EVIDENCE: 60,
  LOCATION_SPOOF_SUSPECTED: 10,
  VPN_OR_PROXY_ONLY: 5
} as const;

export type RiskSignalCode = keyof typeof RISK_SIGNAL_WEIGHTS;
export type RiskBand = 'LOW' | 'REVIEW' | 'HIGH';
export type RiskRecommendation = 'ALLOW' | 'MANUAL_REVIEW';

/** Weak signals may inform a reviewer but must never on their own justify a hold. */
export const WEAK_SIGNAL_CODES: readonly RiskSignalCode[] = ['VPN_OR_PROXY_ONLY', 'LOCATION_SPOOF_SUSPECTED'];

export const RISK_REVIEW_THRESHOLD = 30;
export const RISK_HIGH_THRESHOLD = 70;
export const RISK_SCORE_CAP = 100;

/** Conservative, deterministic producer windows. These never enforce anything. */
export const RISK_PRODUCER_POLICY_VERSION = 'risk-producers-v1';
export const RISK_ORDER_VELOCITY_WINDOW_MINUTES = 10;
export const RISK_ORDER_VELOCITY_MIN_ORDERS = 6;
export const RISK_PAYMENT_FAILED_WINDOW_MINUTES = 15;
export const RISK_PAYMENT_FAILED_MIN_ORDERS = 3;
export const RISK_OTP_INVALID_WINDOW_MINUTES = 15;
export const RISK_OTP_MIN_INVALID_ATTEMPTS = 4;

export interface RiskProducerCaseKeyInput {
  kind: 'ORDER_ABUSE' | 'PAYMENT_ABUSE' | 'ACCOUNT_ABUSE';
  countryId: string;
  subjectUserId: string;
  occurredAt: Date;
}

/** One system case per subject/country/kind/UTC day. Terminal cases are never reopened. */
export function riskProducerCaseKey(input: RiskProducerCaseKeyInput): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.countryId) || !uuid.test(input.subjectUserId)) throw new Error('RISK_PRODUCER_SCOPE_INVALID');
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) throw new Error('RISK_PRODUCER_TIME_INVALID');
  const day = input.occurredAt.toISOString().slice(0, 10);
  return `${RISK_POLICY_VERSION}:${input.kind}:${input.countryId.toLowerCase()}:${input.subjectUserId.toLowerCase()}:${day}`;
}

export function riskProducerWindowStart(occurredAt: Date, windowMinutes: number): Date {
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) throw new Error('RISK_PRODUCER_TIME_INVALID');
  if (!Number.isSafeInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) throw new Error('RISK_PRODUCER_WINDOW_INVALID');
  return new Date(occurredAt.getTime() - windowMinutes * 60_000);
}

export function isRiskSignalCode(code: string): code is RiskSignalCode {
  return Object.prototype.hasOwnProperty.call(RISK_SIGNAL_WEIGHTS, code);
}

export function riskBand(score: number): RiskBand {
  if (!Number.isSafeInteger(score) || score < 0 || score > RISK_SCORE_CAP) throw new Error('RISK_SCORE_INVALID');
  if (score >= RISK_HIGH_THRESHOLD) return 'HIGH';
  if (score >= RISK_REVIEW_THRESHOLD) return 'REVIEW';
  return 'LOW';
}

export interface RiskEvaluation {
  policyVersion: string;
  score: number;
  band: RiskBand;
  recommendation: RiskRecommendation;
  /** Always false: enforcement is a human decision, never a score side effect. */
  automatedEnforcement: false;
  /** Deduplicated, sorted codes actually counted toward the score. */
  countedCodes: RiskSignalCode[];
  /** True when every observed signal is weak; a reviewer must not treat this as proof. */
  weakOnly: boolean;
}

/**
 * Evaluate observed signal codes. Repeats of the same code are counted once so a
 * noisy producer cannot inflate a score by emitting the same evidence twice.
 */
export function evaluateRisk(codes: readonly string[]): RiskEvaluation {
  const unique = new Set<RiskSignalCode>();
  for (const code of codes) {
    if (!isRiskSignalCode(code)) throw new Error('RISK_SIGNAL_UNKNOWN');
    unique.add(code);
  }
  const countedCodes = [...unique].sort();
  const raw = countedCodes.reduce((total, code) => total + RISK_SIGNAL_WEIGHTS[code], 0);
  const score = Math.min(RISK_SCORE_CAP, raw);
  const band = riskBand(score);
  const weakOnly = countedCodes.length > 0 && countedCodes.every(code => WEAK_SIGNAL_CODES.includes(code));

  // A weak-only observation is capped below the review threshold regardless of
  // future weight edits, so VPN usage alone cannot queue a customer for holding.
  const effectiveScore = weakOnly ? Math.min(score, RISK_REVIEW_THRESHOLD - 1) : score;
  const effectiveBand = riskBand(effectiveScore);

  return {
    policyVersion: RISK_POLICY_VERSION,
    score: effectiveScore,
    band: effectiveBand,
    recommendation: effectiveBand === 'LOW' ? 'ALLOW' : 'MANUAL_REVIEW',
    automatedEnforcement: false,
    countedCodes,
    weakOnly
  };
}

/** Reviewer decisions are limited to clearing or confirming for follow-up. */
export type RiskReviewDecision = 'CLEAR' | 'CONFIRM_FRAUD';

export interface RiskReviewInput {
  decision: RiskReviewDecision;
  reviewerUserId: string;
  openedByUserId: string | null;
  subjectUserId: string;
  reason: string;
}

/**
 * A review must be independent and explained. System-opened cases have no human
 * opener, so any authorised reviewer may resolve them; a human opener may not
 * resolve their own case, and nobody may review their own account.
 */
export function assertIndependentRiskReview(input: RiskReviewInput): void {
  if (input.decision !== 'CLEAR' && input.decision !== 'CONFIRM_FRAUD') throw new Error('RISK_DECISION_INVALID');
  if (!input.reviewerUserId) throw new Error('RISK_REVIEWER_REQUIRED');
  if (input.reviewerUserId === input.subjectUserId) throw new Error('RISK_SELF_REVIEW_DENIED');
  if (input.openedByUserId !== null && input.reviewerUserId === input.openedByUserId) throw new Error('RISK_REVIEW_NOT_INDEPENDENT');
  const reason = input.reason.trim();
  if (reason.length < 8 || reason.length > 512) throw new Error('RISK_REVIEW_REASON_INVALID');
}
