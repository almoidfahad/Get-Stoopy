import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../src/index.js';
import { NotificationService } from '../../../apps/api/src/notification/notification.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const notificationId = '22222222-2222-4222-8222-222222222222';
const ctx = { userId, sessionId: userId, authorizationVersion: 1, accountStatus: 'ACTIVE', assurance: 'PASSWORD', permissions: ['notification.update'], scopes: [], vendorMemberships: [], now: new Date().toISOString() } as AccessContext;
const readAt = new Date('2025-01-01T00:00:00Z');
const row = { id: notificationId, userId, type: 'SYSTEM_ALERT', channel: 'IN_APP', status: 'READ', subject: 'Notice', body: 'Text', templateId: null, commandKey: 'command-123', sentAt: null, readAt, createdAt: readAt, updatedAt: readAt };

function fixture(found: unknown) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue(found ? [found] : []),
    notification: { update: vi.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) }
  };
  const db = { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) };
  return { service: new NotificationService(db as any, db as any), tx };
}

describe('notification mark-read retry', () => {
  it('checks owner under row lock and returns a retry without writes', async () => {
    const { service, tx } = fixture(row);
    const result = await service.markRead(ctx, notificationId, userId);
    expect(result).toMatchObject({ notificationId, status: 'READ', readAt, duplicate: true });
    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/"userId"\s*=\s*\?::uuid\s+FOR UPDATE/);
    expect(values).toEqual([notificationId, userId]);
    expect(tx.notification.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3); // only RLS settings, no audit
  });

  it('updates unread state once and creates one audit and outbox event', async () => {
    const { service, tx } = fixture({ ...row, status: 'PENDING', readAt: null });
    const result = await service.markRead(ctx, notificationId, userId);
    expect(result).toMatchObject({ status: 'READ', duplicate: false });
    expect(result.readAt).toBeInstanceOf(Date);
    expect(tx.notification.update).toHaveBeenCalledOnce();
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(4); // RLS plus one audit
  });

  it('does not write when no owned row exists', async () => {
    const { service, tx } = fixture(null);
    await expect(service.markRead(ctx, notificationId, userId)).rejects.toMatchObject({ status: 404, response: { code: 'NOTIFICATION_NOT_FOUND' } });
    expect(tx.notification.update).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});
