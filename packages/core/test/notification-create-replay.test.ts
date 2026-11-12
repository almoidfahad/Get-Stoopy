import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext, NotificationInput } from '../src/index.js';
import { NotificationService } from '../../../apps/api/src/notification/notification.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const templateId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ctx = { userId, sessionId: userId, authorizationVersion: 1, accountStatus: 'ACTIVE', assurance: 'PASSWORD', permissions: ['notification.create'], scopes: [], vendorMemberships: [], now: new Date().toISOString() } as AccessContext;
const input: NotificationInput = { userId, type: 'SYSTEM_ALERT', channel: 'IN_APP', subject: 'Notice', body: 'Text', templateId, commandKey: 'test-key-123' };
const row = { id: '22222222-2222-4222-8222-222222222222', ...input, payloadHash: 'legacy-key-hash', status: 'PENDING', readAt: null, sentAt: null, createdAt: new Date(), updatedAt: new Date() };

function fixture(existing: unknown) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    notification: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn().mockResolvedValue(row) },
    notificationAttempt: { create: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) }
  };
  const db = { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) };
  return { service: new NotificationService(db as any, db as any), tx };
}

describe('notification create retry', () => {
  it('locks before lookup and replays matching legacy records including UUID case differences', async () => {
    const { service, tx } = fixture(row);
    const result = await service.createNotification(ctx, { ...input, templateId: templateId.toUpperCase() });
    expect(result).toMatchObject({ notificationId: row.id, duplicate: true });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4);
    const [sql, lockKey] = tx.$executeRaw.mock.calls[3];
    expect(sql.join('?')).toContain('pg_advisory_xact_lock');
    expect(lockKey).toBe(`notification-create:${userId}:${input.commandKey}`);
    expect(tx.$executeRaw.mock.invocationCallOrder[3]).toBeLessThan(tx.notification.findFirst.mock.invocationCallOrder[0]);
    expect(tx.notification.findFirst).toHaveBeenCalledWith({ where: { userId, commandKey: input.commandKey } });
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.notificationAttempt.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'ORDER_STATUS' }, { channel: 'SMS' }, { subject: 'Other' }, { body: 'Other' }, { templateId: null },
  ] as const)('rejects reused keys when content differs: %o', async changed => {
    const { service, tx } = fixture(row);
    await expect(service.createNotification(ctx, { ...input, ...changed })).rejects.toMatchObject({ status: 409, response: { code: 'NOTIFICATION_IDEMPOTENCY_CONFLICT' } });
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.notificationAttempt.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('creates one notification, attempt, audit and outbox event for a new key', async () => {
    const { service, tx } = fixture(null);
    const result = await service.createNotification(ctx, input);
    expect(result).toMatchObject({ notificationId: row.id, duplicate: false });
    expect(tx.notification.create).toHaveBeenCalledOnce();
    expect(tx.notificationAttempt.create).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(5); // RLS, lock, audit
  });
});
