import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext, NotificationInput } from '../src/index.js';
import { NotificationService } from '../../../apps/api/src/notification/notification.service.js';

const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const input: NotificationInput = { userId: own, type: 'SYSTEM_ALERT', channel: 'IN_APP', subject: 'Notice', body: 'Text', commandKey: 'test-key-123' };
function context(...permissions: string[]): AccessContext {
  return { userId: own, sessionId: own, authorizationVersion: 1, accountStatus: 'ACTIVE', assurance: 'PASSWORD', permissions, scopes: [], vendorMemberships: [], now: new Date().toISOString() };
}
function service() {
  const reachedDatabase = new Error('reached database');
  const transaction = vi.fn().mockRejectedValue(reachedDatabase);
  const db = { $transaction: transaction };
  return { service: new NotificationService(db as any, db as any), transaction, reachedDatabase };
}

describe('notification operation permissions', () => {
  it('does not allow read-only users to create or modify their notifications', async () => {
    const { service: s, transaction } = service();
    await expect(s.createNotification(context('notification.read'), input)).rejects.toMatchObject({ status: 403 });
    await expect(s.markRead(context('notification.read'), own, own)).rejects.toMatchObject({ status: 403 });
    await expect(s.updatePreference(context('notification.read'), own, 'EMAIL', false)).rejects.toMatchObject({ status: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not allow create/update permissions to read notifications or preferences', async () => {
    const { service: s, transaction } = service();
    await expect(s.listNotifications(context('notification.create'), own, { limit: 10 })).rejects.toMatchObject({ status: 403 });
    await expect(s.getNotification(context('notification.update'), own, own)).rejects.toMatchObject({ status: 403 });
    await expect(s.getPreferences(context('notification.update'), own)).rejects.toMatchObject({ status: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('still denies access to another owner even with the required permission or wildcard', async () => {
    const { service: s, transaction } = service();
    await expect(s.createNotification(context('notification.create'), { ...input, userId: other })).rejects.toMatchObject({ status: 403 });
    await expect(s.getPreferences(context('*'), other)).rejects.toMatchObject({ status: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['create', (s: NotificationService, ctx: AccessContext) => s.createNotification(ctx, input), 'notification.create'],
    ['list', (s: NotificationService, ctx: AccessContext) => s.listNotifications(ctx, own, { limit: 10 }), 'notification.read'],
    ['get', (s: NotificationService, ctx: AccessContext) => s.getNotification(ctx, own, own), 'notification.read'],
    ['read', (s: NotificationService, ctx: AccessContext) => s.markRead(ctx, own, own), 'notification.update'],
    ['get preferences', (s: NotificationService, ctx: AccessContext) => s.getPreferences(ctx, own), 'notification.read'],
    ['update preferences', (s: NotificationService, ctx: AccessContext) => s.updatePreference(ctx, own, 'EMAIL', true), 'notification.update'],
  ] as const)('%s reaches the database with its specific permission', async (_name, action, permission) => {
    const { service: s, transaction, reachedDatabase } = service();
    await expect(action(s, context(permission))).rejects.toBe(reachedDatabase);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('allows wildcard permission for the owner', async () => {
    const { service: s, transaction, reachedDatabase } = service();
    await expect(s.getPreferences(context('*'), own)).rejects.toBe(reachedDatabase);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
