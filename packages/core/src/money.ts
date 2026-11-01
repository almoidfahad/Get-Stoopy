export interface Money { amountMinor: number; currency: string; }
export function assertMoney(m: Money): void {
  if (!Number.isSafeInteger(m.amountMinor) || m.amountMinor < 0) throw new Error('INVALID_MINOR_UNITS');
  if (!/^[A-Z]{3}$/.test(m.currency)) throw new Error('INVALID_CURRENCY');
}
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error('CURRENCY_MISMATCH');
  const r = { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency }; assertMoney(r); return r;
}
export function allocateProRata(total: Money, weights: number[]): Money[] {
  assertMoney(total);
  if (!weights.length || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('INVALID_WEIGHTS');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('ZERO_WEIGHT');
  const raw = weights.map(w => (BigInt(total.amountMinor) * BigInt(w)) / BigInt(sum));
  let rem = BigInt(total.amountMinor) - raw.reduce((a, b) => a + b, 0n);
  const order = weights.map((w, i) => ({ i, frac: (BigInt(total.amountMinor) * BigInt(w)) % BigInt(sum) })).sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));
  for (let k = 0; k < Number(rem); k++) raw[order[k]!.i] = raw[order[k]!.i]! + 1n;
  return raw.map(x => ({ amountMinor: Number(x), currency: total.currency }));
}
export interface JournalLine { accountId: string; side: 'DEBIT' | 'CREDIT'; amountMinor: number; currency: string; }
export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new Error('JOURNAL_TOO_SMALL');
  const totals = new Map<string, bigint>();
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0) throw new Error('INVALID_LINE');
    const d = totals.get(l.currency) ?? 0n;
    totals.set(l.currency, d + BigInt(l.side === 'DEBIT' ? l.amountMinor : -l.amountMinor));
  }
  for (const [c, v] of totals) if (v !== 0n) throw new Error('UNBALANCED_' + c);
}
export function commissionBps(basis: Money, bps: number): Money {
  assertMoney(basis);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('INVALID_BPS');
  return { amountMinor: Number((BigInt(basis.amountMinor) * BigInt(bps) + 5000n) / 10000n), currency: basis.currency };
}
