import { describe, expect, it } from 'vitest';
import { manualReady, transition, suborderTransitions } from '../src/index.js';
describe('state machine', () => {
  it('requires manual ready by vendor', () => expect(() => manualReady('PREPARING', 'VENDOR', false)).not.toThrow());
  it('rejects timer-driven ready', () => expect(() => manualReady('PREPARING', 'VENDOR', true)).toThrow('TIMER_CANNOT_CONFIRM_READY'));
  it('rejects customer ready', () => expect(() => manualReady('PREPARING', 'CUSTOMER', false)).toThrow('READY_ACTOR_DENIED'));
  it('rejects skipped states', () => expect(() => transition(suborderTransitions, 'PENDING_VENDOR', 'DELIVERED')).toThrow());
});
