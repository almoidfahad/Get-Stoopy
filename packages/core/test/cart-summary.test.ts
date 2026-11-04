import { describe, expect, it } from 'vitest';
import { CART_ISSUE_MESSAGES, parseCartMutation, summarizeCart, type CartLineInput } from '../src/index.js';

const line = (over: Partial<CartLineInput> = {}): CartLineInput => ({
  variantId: '11111111-1111-1111-1111-111111111111',
  quantity: 2,
  unitPriceMinor: '50000',
  lineTotalMinor: '100000',
  currency: 'BDT',
  availableToPromise: 10,
  sellable: true,
  ...over,
});

describe('cart totals', () => {
  it('sums lines in minor units without a float', () => {
    const summary = summarizeCart([line(), line({ variantId: 'v2', quantity: 1, unitPriceMinor: '25000', lineTotalMinor: '25000' })]);
    expect(summary.subtotalMinor).toBe(125000n);
    expect(summary.lineCount).toBe(2);
    expect(summary.unitCount).toBe(3);
    expect(summary.currency).toBe('BDT');
    expect(summary.readyForCheckout).toBe(true);
  });

  it('keeps precision above 2^53 minor units', () => {
    const summary = summarizeCart([
      line({ quantity: 100, unitPriceMinor: '90071992547409', lineTotalMinor: '9007199254740900' }),
    ]);
    expect(summary.subtotalMinor).toBe(9007199254740900n);
  });

  it('reports an empty cart with no subtotal and not ready', () => {
    const summary = summarizeCart([]);
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.currency).toBeNull();
    expect(summary.readyForCheckout).toBe(false);
    expect(summary.issues).toEqual([]);
  });
});

describe('cart problems are surfaced, not hidden', () => {
  it('flags a line whose server total disagrees with unit price × quantity', () => {
    const summary = summarizeCart([line({ lineTotalMinor: '999' })]);
    expect(summary.issues).toContainEqual({ variantId: line().variantId, kind: 'line-total-mismatch' });
    // Still shows the independently computed figure so the buyer is not misled.
    expect(summary.subtotalMinor).toBe(100000n);
    expect(summary.readyForCheckout).toBe(false);
  });

  it('flags a malformed server total', () => {
    const summary = summarizeCart([line({ lineTotalMinor: 'oops' })]);
    expect(summary.issues.map(i => i.kind)).toContain('line-total-mismatch');
  });

  it('flags an unsellable item and blocks checkout', () => {
    const summary = summarizeCart([line({ sellable: false })]);
    expect(summary.issues.map(i => i.kind)).toContain('not-sellable');
    expect(summary.readyForCheckout).toBe(false);
  });

  it('flags stock below the requested quantity but keeps the subtotal visible', () => {
    const summary = summarizeCart([line({ availableToPromise: 1 })]);
    expect(summary.issues.map(i => i.kind)).toContain('insufficient-stock');
    expect(summary.subtotalMinor).toBe(100000n);
    expect(summary.readyForCheckout).toBe(false);
  });

  it('refuses to produce a subtotal when a price is invalid', () => {
    for (const bad of ['abc', '0', '-1']) {
      const summary = summarizeCart([line({ unitPriceMinor: bad, lineTotalMinor: bad })]);
      expect(summary.subtotalMinor).toBeNull();
      expect(summary.issues.map(i => i.kind)).toContain('price-invalid');
    }
  });

  it('never sums two different currencies', () => {
    const summary = summarizeCart([line(), line({ variantId: 'v2', currency: 'USD' })]);
    expect(summary.subtotalMinor).toBeNull();
    expect(summary.issues.map(i => i.kind)).toContain('currency-mismatch');
    expect(summary.readyForCheckout).toBe(false);
  });

  it('rejects an out-of-range quantity instead of pricing it', () => {
    for (const quantity of [0, -1, 101, 1.5]) {
      const summary = summarizeCart([line({ quantity })]);
      expect(summary.issues.map(i => i.kind)).toContain('quantity-invalid');
      expect(summary.subtotalMinor).toBeNull();
    }
  });

  it('flags more than the allowed number of distinct items', () => {
    const lines = Array.from({ length: 51 }, (_, i) => line({ variantId: `v${i}` }));
    const summary = summarizeCart(lines);
    expect(summary.issues).toContainEqual({ variantId: null, kind: 'too-many-items' });
    expect(summary.readyForCheckout).toBe(false);
  });

  it('has a buyer-facing message for every issue kind', () => {
    const kinds = new Set(
      summarizeCart([
        line({ sellable: false, availableToPromise: 0, lineTotalMinor: '1' }),
        line({ variantId: 'v2', currency: 'USD' }),
        line({ variantId: 'v3', quantity: 0 }),
        line({ variantId: 'v4', unitPriceMinor: 'x' }),
      ]).issues.map(i => i.kind),
    );
    expect(kinds.size).toBeGreaterThan(3);
    for (const kind of kinds) expect(CART_ISSUE_MESSAGES[kind].length).toBeGreaterThan(10);
  });
});
describe('cart mutation validation', () => {
  const variantId = '11111111-2222-3333-4444-555555555555';

  it('accepts an add with a quantity and ignores any browser-supplied version', () => {
    const parsed = parseCartMutation('add', { variantId, quantity: 3, expectedVersion: 99 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.quantity).toBe(3);
      // The version for `add` is resolved server-side, never trusted from the client.
      expect(parsed.value.expectedVersion).toBeUndefined();
    }
  });

  it('requires the displayed version for update and remove', () => {
    for (const op of ['update', 'remove'] as const) {
      expect(parseCartMutation(op, { variantId, quantity: 2 }).ok).toBe(false);
      const parsed = parseCartMutation(op, { variantId, quantity: 2, expectedVersion: 7 });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.expectedVersion).toBe(7);
    }
  });

  it('does not require a quantity for remove', () => {
    const parsed = parseCartMutation('remove', { variantId, expectedVersion: 1 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.quantity).toBeUndefined();
  });

  it('rejects a non-uuid variant id, including traversal and injection shapes', () => {
    for (const bad of ['', 'nope', '../../etc/passwd', "'; DROP TABLE--", 42, null]) {
      const parsed = parseCartMutation('add', { variantId: bad, quantity: 1 });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe('VARIANT_ID_INVALID');
    }
  });

  it('rejects out-of-range or non-integer quantities', () => {
    for (const quantity of [0, -1, 101, 1.5, '2', null]) {
      const parsed = parseCartMutation('add', { variantId, quantity });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe('QUANTITY_INVALID');
    }
  });

  it('rejects a malformed body', () => {
    for (const body of [null, undefined, 'x', 5, []]) {
      expect(parseCartMutation('add', body).ok).toBe(false);
    }
  });
});
