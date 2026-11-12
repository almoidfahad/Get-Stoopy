import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { hasPermission, type AccessContext, type NotificationChannel, type NotificationInput } from '@getstoopy/core';

/**
 * Notification service.
 *
 * Creates and lists user-scoped notifications. Delivery is not yet connected to
 * a real email/SMS/push provider; the service records a PENDING notification and
 * a delivery attempt, leaving status at PENDING until a provider adapter is
 * approved and wired in.
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService,
  ) {}

  private requireOwner(ctx: AccessContext, userId: string, permission: 'notification.create' | 'notification.read' | 'notification.update') {
    if (!hasPermission(ctx, permission)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Notification permission denied' });
    }
    if (ctx.userId !== userId) {
      throw new ForbiddenException({ code: 'NOTIFICATION_FOR_OWNER_ONLY', message: 'You can only access your own notifications.' });
    }
  }

  private async audit(
    tx: any,
    ctx: AccessContext,
    action: string,
    resourceId: string,
    reason?: string,
  ) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER'::"ActorType", ${ctx.sessionId}::uuid, ${action}, 'Notification', ${resourceId}::uuid, ${JSON.stringify({})}::jsonb, ${reason ?? null}, ${randomUUID()}::uuid)`;
  }

  private async outbox(
    tx: any,
    aggregateId: string,
    eventType: string,
    eventKey: string,
    userId: string,
    data: Record<string, unknown>,
  ) {
    const occurredAt = new Date();
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Notification',
        aggregateId,
        eventKey,
        eventType,
        occurredAt,
        payload: {
          schemaVersion: 1,
          eventKey,
          eventType,
          occurredAt: occurredAt.toISOString(),
          aggregateType: 'Notification',
          aggregateId,
          userId,
          data,
        },
      },
    });
  }

  async createNotification(ctx: AccessContext, input: NotificationInput) {
    this.requireOwner(ctx, input.userId, 'notification.create');

    return this.privileged.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      // Serialize the per-user command before the lookup; a unique index alone
      // would turn simultaneous retries into an unhandled uniqueness error.
      // The lock is coordination only: requireOwner already authorized access.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-create:${input.userId.toLowerCase()}:${input.commandKey}`}, 0))`;
      const existing = await tx.notification.findFirst({
        where: { userId: input.userId, commandKey: input.commandKey },
      });
      if (existing) {
        // Compare stored fields rather than hashing potentially sensitive text.
        // The legacy payloadHash contains only the key and cannot detect a
        // changed message; comparing fields also works for existing rows.
        const templateId = input.templateId?.toLowerCase() ?? null;
        if (existing.type !== input.type || existing.channel !== input.channel || existing.subject !== input.subject || existing.body !== input.body || existing.templateId !== templateId) {
          throw new ConflictException({ code: 'NOTIFICATION_IDEMPOTENCY_CONFLICT', message: 'Notification command key already used with different content' });
        }
        return this.notificationJson(existing, true);
      }

      const payloadHash = createHash('sha256').update(input.commandKey).digest('hex');
      const notification = await tx.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          channel: input.channel,
          status: 'PENDING',
          subject: input.subject,
          body: input.body,
          templateId: input.templateId ?? null,
          commandKey: input.commandKey,
          payloadHash,
        },
      });

      // Record the initial delivery attempt as PENDING (provider not yet wired).
      await tx.notificationAttempt.create({
        data: {
          notificationId: notification.id,
          channel: input.channel,
          status: 'PENDING',
        },
      });

      await this.audit(tx, ctx, 'notification.created', notification.id, undefined);
      await this.outbox(tx, notification.id, 'notification.created', `notification-created-${notification.id}`, input.userId, {
        type: input.type,
        channel: input.channel,
        status: 'PENDING',
      });

      return this.notificationJson(notification, false);
    }, { timeout: 30000 });
  }

  async listNotifications(
    ctx: AccessContext,
    userId: string,
    { status, channel, limit, cursor }: { status?: string; channel?: string; limit: number; cursor?: string },
  ) {
    this.requireOwner(ctx, userId, 'notification.read');

    return this.db.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      const where: Record<string, unknown> = { userId };
      if (status) where['status'] = status;
      if (channel) where['channel'] = channel;

      const take = Math.min(limit + 1, 100);
      const rows = await tx.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      return {
        items: items.map(n => this.notificationJson(n)),
        nextCursor,
      };
    });
  }

  async getNotification(ctx: AccessContext, notificationId: string, userId: string) {
    this.requireOwner(ctx, userId, 'notification.read');

    return this.db.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      const notification = await tx.notification.findFirst({
        where: { id: notificationId, userId },
      });
    if (!notification) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'That notification does not exist.',
      });
    }
    return this.notificationJson(notification);
    });
  }

  async markRead(ctx: AccessContext, notificationId: string, userId: string) {
    this.requireOwner(ctx, userId, 'notification.update');

    return this.privileged.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      // Lock and authorize before inspecting the state: simultaneous retries
      // must not produce a second audit/outbox event or rewrite readAt.
      const rows = await tx.$queryRaw`SELECT * FROM "Notification" WHERE "id"=${notificationId}::uuid AND "userId"=${userId}::uuid FOR UPDATE`;
      const notification = (rows as any[])[0];
      if (!notification) {
        throw new NotFoundException({
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'That notification does not exist.',
        });
      }
      if (notification.status === 'READ') return this.notificationJson(notification, true);

      const updated = await tx.notification.update({
        where: { id: notificationId },
        data: { status: 'READ', readAt: new Date() },
      });

      await this.audit(tx, ctx, 'notification.read', notificationId, undefined);
      await this.outbox(tx, notificationId, 'notification.read', `notification-read-${notificationId}`, userId, {
        status: 'READ',
      });

      return this.notificationJson(updated);
    });
  }

  async getPreferences(ctx: AccessContext, userId: string) {
    this.requireOwner(ctx, userId, 'notification.read');

    return this.db.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      return tx.notificationPreference.findMany({
        where: { userId },
        orderBy: { channel: 'asc' },
      });
    });
  }

  async updatePreference(
    ctx: AccessContext,
    userId: string,
    channel: string,
    enabled: boolean,
  ) {
    this.requireOwner(ctx, userId, 'notification.update');

    return this.privileged.$transaction(async tx => {
      await setRls(tx, {
        userId: ctx.userId,
        authorizationVersion: ctx.authorizationVersion,
        isSuper: true,
      });

      return tx.notificationPreference.upsert({
        where: { userId_channel: { userId, channel: channel as any } },
        update: { enabled },
        create: { userId, channel: channel as any, enabled },
      });
    });
  }

  private notificationJson(n: any, duplicate = false) {
    return {
      notificationId: n.id,
      userId: n.userId,
      type: n.type,
      channel: n.channel,
      status: n.status,
      subject: n.subject,
      body: n.body,
      templateId: n.templateId,
      commandKey: n.commandKey,
      sentAt: n.sentAt,
      readAt: n.readAt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      duplicate,
    };
  }
}

function randomUUID(): string {
  return crypto.randomUUID();
}
