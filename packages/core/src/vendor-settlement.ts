export interface SettlementLine { grossMinor: bigint; commissionBps: number; }
export interface SettlementAmounts { grossMinor: bigint; commissionMinor: bigint; netMinor: bigint; }
/** Explicit development rounding policy: floor to minor unit per suborder; never aggregate-percent rounding. */
export function settlementLineAmounts(line: SettlementLine): SettlementAmounts {
  if (line.grossMinor <= 0n || line.grossMinor > 9_000_000_000_000n) throw new Error('SETTLEMENT_GROSS_INVALID');
  if (!Number.isInteger(line.commissionBps) || line.commissionBps < 0 || line.commissionBps >= 10000) throw new Error('SETTLEMENT_BPS_INVALID');
  const commissionMinor = line.grossMinor * BigInt(line.commissionBps) / 10000n;
  const netMinor = line.grossMinor - commissionMinor;
  if (netMinor <= 0n) throw new Error('SETTLEMENT_NET_INVALID');
  return { grossMinor: line.grossMinor, commissionMinor, netMinor };
}
export function settlementTotals(lines: readonly SettlementLine[]): SettlementAmounts {
  if (!lines.length || lines.length > 100) throw new Error('SETTLEMENT_ITEMS_INVALID');
  return lines.map(settlementLineAmounts).reduce((a, b) => ({ grossMinor: a.grossMinor + b.grossMinor, commissionMinor: a.commissionMinor + b.commissionMinor, netMinor: a.netMinor + b.netMinor }), { grossMinor: 0n, commissionMinor: 0n, netMinor: 0n });
}
export function settlementHoldUntil(completedAt: Date, holdDays: number): Date {
  if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 90 || !Number.isFinite(completedAt.getTime())) throw new Error('SETTLEMENT_HOLD_INVALID');
  return new Date(completedAt.getTime() + holdDays * 86400_000);
}
