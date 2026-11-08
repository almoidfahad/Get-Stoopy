import { describe, expect, it } from 'vitest';
import { calculateStock } from '../src/lib/stock-calculation';

describe('local stock calculation', () => {
  it.each([['', ''], ['10', ''], ['', '0']])('waits for both inputs (%s, %s)', (onHand, reserved) => {
    expect(calculateStock(onHand, reserved)).toEqual({ status: 'incomplete' });
  });
  it.each([['12', '3', 9], ['0', '0', 0], ['1000000', '1', 999999], ['04', '04', 0]])('calculates %s minus %s', (onHand, reserved, available) => {
    expect(calculateStock(onHand, reserved)).toEqual({ status: 'ready', available });
  });
  it.each(['-1', '1.5', '1e2', ' ', '1000001', '9007199254740992'])('rejects invalid on-hand input %s', value => {
    expect(calculateStock(value, '0')).toMatchObject({ status: 'invalid', field: 'onHand' });
  });
  it('rejects reserved quantities above on-hand', () => {
    expect(calculateStock('2', '3')).toMatchObject({ status: 'invalid', field: 'reserved' });
  });
  it('rejects invalid reserved quantity even if on-hand is blank', () => {
    expect(calculateStock('', '-1')).toMatchObject({ status: 'invalid', field: 'reserved' });
  });
});
