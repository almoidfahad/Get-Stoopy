export type SandboxTransferStatus = 'RESERVED' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED';
export function assertSandboxTransition(from: SandboxTransferStatus, to: SandboxTransferStatus): void {
  const allowed: Record<SandboxTransferStatus, SandboxTransferStatus[]> = { RESERVED: ['SUBMITTED'], SUBMITTED: ['SUCCEEDED', 'FAILED'], SUCCEEDED: [], FAILED: [] };
  if (!allowed[from].includes(to)) throw new Error('SANDBOX_TRANSFER_TRANSITION_INVALID');
}
/** Signed adjustments are integer minor units; cumulative payable must remain non-negative. */
export function adjustedPayableMinor(netMinor: bigint, adjustments: readonly bigint[]): bigint {
  if (netMinor <= 0n || adjustments.some(a => BigInt.asIntN(53, a) !== a)) throw new Error('ADJUSTMENT_AMOUNT_INVALID');
  const result = adjustments.reduce((sum, a) => sum + a, netMinor);
  if (result < 0n || result > 9_000_000_000_000n) throw new Error('ADJUSTMENT_PAYABLE_INVALID');
  return result;
}
export function sandboxProviderReference(kind: 'REFUND' | 'PAYOUT', id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('SANDBOX_TRANSFER_ID_INVALID');
  return `TEST_ONLY:${kind}:${id}`;
}
