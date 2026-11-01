import { Inject, Injectable, UnauthorizedException, ForbiddenException, ConflictException, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { decryptJson, encryptJson } from '@getstoopy/bff';
import { generateTotpSecret, verifyTotp, otpauthUri, generateRecoveryCodes, hashToken } from '@getstoopy/auth';
import type { AccessContext } from '@getstoopy/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const STEP_UP_MINUTES = 10;
function sha256(v: string): string { return createHash('sha256').update(v).digest('hex'); }
@Injectable()
export class SecurityService implements OnModuleDestroy {
  private redis: Redis;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  }
  async onModuleDestroy() { await this.redis.quit(); }
  private keySet() { if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(`${this.env.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`)); return this.jwks; }
  private async rateLimit(key: string, limit: number, windowSec: number) {
    await this.redis.connect().catch(() => undefined);
    const full = `gs:security:${key}`;
    const count = await this.redis.incr(full);
    if (count === 1) await this.redis.expire(full, windowSec);
    if (count > limit) throw new ForbiddenException({ code: 'RATE_LIMITED', message: 'Too many attempts; try later' });
  }
  private async audit(tx: any, ctx: AccessContext, action: string, resourceType: string, resourceId: string | null, reason?: string) {
    // Insert without RETURNING: runtime RLS intentionally has no AuditLog SELECT policy.
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, ${resourceType}, ${resourceId}::uuid, '{}'::jsonb, ${reason ?? null}, ${randomUUID()})`;
  }
  async status(ctx: AccessContext) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const mfa = await tx.userMfa.findUnique({ where: { userId: ctx.userId } });
      const recovery = await tx.recoveryCode.count({ where: { userId: ctx.userId, usedAt: null, revokedAt: null } });
      return { mfaState: mfa?.state ?? 'NONE', recoveryCodesRemaining: recovery, stepUpExpiresAt: null as string | null };
    });
  }
  async beginEnrollment(ctx: AccessContext) {
    await this.rateLimit(`mfa-enroll:${ctx.userId}`, 5, 600);
    const secret = generateTotpSecret();
    const envelope = Buffer.from(encryptJson({ secret }, this.env.SESSION_TOKEN_ENCRYPTION_KEY));
    const account = `user-${ctx.userId}`;
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const existing = await tx.userMfa.findUnique({ where: { userId: ctx.userId } });
      if (existing?.state === 'ACTIVE') throw new ConflictException({ code: 'MFA_ALREADY_ACTIVE', message: 'Step-up required to replace active MFA' });
      await tx.userMfa.upsert({ where: { userId: ctx.userId }, create: { userId: ctx.userId, secretEnvelope: envelope, state: 'PENDING' }, update: { secretEnvelope: envelope, state: 'PENDING', confirmedAt: null, lastUsedCounter: BigInt(-1) } });
      await this.audit(tx, ctx, 'security.mfa.enrollment_started', 'UserMfa', ctx.userId);
    });
    return { otpauthUri: otpauthUri({ issuer: 'Get Stoopy', account, secret }), secret, digits: 6, period: 30 };
  }
  async confirmEnrollment(ctx: AccessContext, code: string) {
    await this.rateLimit(`mfa-confirm:${ctx.userId}`, 10, 600);
    const recoveryCodes = generateRecoveryCodes(10);
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const mfa = await tx.userMfa.findUnique({ where: { userId: ctx.userId } });
      if (!mfa || mfa.state !== 'PENDING') throw new BadRequestException({ code: 'MFA_NOT_PENDING', message: 'Start enrollment first' });
      const { secret } = decryptJson<{ secret: string }>(Buffer.from(mfa.secretEnvelope).toString('utf8'), this.env.SESSION_TOKEN_ENCRYPTION_KEY);
      const verified = verifyTotp(secret, code, { digits: mfa.digits, period: mfa.period, lastUsedCounter: Number(mfa.lastUsedCounter) });
      if (!verified) throw new UnauthorizedException({ code: 'MFA_CODE_INVALID', message: 'Invalid authenticator code' });
      await tx.userMfa.update({ where: { userId: ctx.userId }, data: { state: 'ACTIVE', confirmedAt: new Date(), lastUsedCounter: BigInt(verified.counter) } });
      await tx.recoveryCode.updateMany({ where: { userId: ctx.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.recoveryCode.createMany({ data: recoveryCodes.map(c => ({ userId: ctx.userId, codeHash: sha256(c) })) });
      await this.audit(tx, ctx, 'security.mfa.enrolled', 'UserMfa', ctx.userId);
    });
    return { enrolled: true, recoveryCodes };
  }
  async stepUp(ctx: AccessContext, input: { code?: string; recoveryCode?: string }) {
    await this.rateLimit(`mfa-stepup:${ctx.userId}`, 10, 600);
    const expires = new Date(Date.now() + STEP_UP_MINUTES * 60_000);
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const mfa = await tx.userMfa.findUnique({ where: { userId: ctx.userId } });
      if (!mfa || mfa.state !== 'ACTIVE') throw new ForbiddenException({ code: 'MFA_ENROLLMENT_REQUIRED', message: 'Active MFA is required' });
      let ok = false;
      if (input.code) {
        const { secret } = decryptJson<{ secret: string }>(Buffer.from(mfa.secretEnvelope).toString('utf8'), this.env.SESSION_TOKEN_ENCRYPTION_KEY);
        const verified = verifyTotp(secret, input.code, { digits: mfa.digits, period: mfa.period, lastUsedCounter: Number(mfa.lastUsedCounter) });
        if (verified) { ok = true; await tx.userMfa.update({ where: { userId: ctx.userId }, data: { lastUsedCounter: BigInt(verified.counter) } }); }
      } else if (input.recoveryCode) {
        const codeHash = sha256(input.recoveryCode.trim().toUpperCase());
        const rec = await tx.recoveryCode.findFirst({ where: { userId: ctx.userId, codeHash, usedAt: null, revokedAt: null } });
        if (rec) { ok = true; await tx.recoveryCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }); }
      }
      if (!ok) throw new UnauthorizedException({ code: 'MFA_CODE_INVALID', message: 'Invalid authenticator or recovery code' });
      await tx.session.update({ where: { id: ctx.sessionId }, data: { assuranceLevel: 'STEP_UP', stepUpExpiresAt: expires } });
      await this.audit(tx, ctx, 'security.step_up', 'Session', ctx.sessionId);
    });
    return { stepUp: true, expiresAt: expires.toISOString() };
  }
  async regenerateRecoveryCodes(ctx: AccessContext) {
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up required' });
    const codes = generateRecoveryCodes(10);
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      await tx.recoveryCode.updateMany({ where: { userId: ctx.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.recoveryCode.createMany({ data: codes.map(c => ({ userId: ctx.userId, codeHash: sha256(c) })) });
      await this.audit(tx, ctx, 'security.recovery.regenerated', 'User', ctx.userId);
    });
    return { recoveryCodes: codes };
  }
  async listSessions(ctx: AccessContext) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const sessions = await tx.session.findMany({ where: { userId: ctx.userId, state: 'ACTIVE', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
      return sessions.map(s => ({ id: s.id, current: s.id === ctx.sessionId, deviceLabel: s.deviceLabel, assurance: s.assuranceLevel, createdAt: s.createdAt, idleExpiresAt: s.idleExpiresAt, expiresAt: s.expiresAt, stepUpExpiresAt: s.stepUpExpiresAt }));
    });
  }
  async revokeSession(ctx: AccessContext, sessionId: string, reason = 'user_requested') {
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const session = await tx.session.findFirst({ where: { id: sessionId, userId: ctx.userId } });
      if (!session) throw new ForbiddenException({ code: 'SESSION_NOT_FOUND', message: 'Session not found' });
      await tx.session.update({ where: { id: sessionId }, data: { state: 'REVOKED', revokedAt: new Date(), revokedReason: reason } });
      await this.audit(tx, ctx, 'security.session.revoked', 'Session', sessionId, reason);
    });
  }
  async revokeOtherSessions(ctx: AccessContext) {
    return this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const r = await tx.session.updateMany({ where: { userId: ctx.userId, id: { not: ctx.sessionId }, state: 'ACTIVE' }, data: { state: 'REVOKED', revokedAt: new Date(), revokedReason: 'user_revoke_others' } });
      await this.audit(tx, ctx, 'security.session.revoke_others', 'User', ctx.userId);
      return { revoked: r.count };
    });
  }
  async emergencyRevokeUser(ctx: AccessContext, targetUserId: string, reason: string) {
    if (!ctx.permissions.includes('security:session:revoke') && !ctx.permissions.includes('*')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Security revocation permission required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up required' });
    if (!reason || reason.length < 8) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Incident reason required' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) throw new BadRequestException({ code: 'USER_NOT_FOUND', message: 'User not found' });
      await tx.user.update({ where: { id: targetUserId }, data: { authorizationVersion: { increment: 1 } } });
      const revoked = await tx.session.updateMany({ where: { userId: targetUserId, state: 'ACTIVE' }, data: { state: 'REVOKED', revokedAt: new Date(), revokedReason: 'emergency_revocation' } });
      await tx.auditLog.create({ data: { actorId: ctx.userId, actorType: 'USER', sessionId: ctx.sessionId, action: 'security.emergency_revoke', resourceType: 'User', resourceId: targetUserId, scopeSnapshot: {}, reason, requestId: randomUUID() } });
      const eventKey = `emergency-revoke-${randomUUID()}`;
      await tx.outboxEvent.create({ data: { aggregateType: 'User', aggregateId: targetUserId, eventKey, eventType: 'security.user.revoked', payload: { schemaVersion: 1, eventKey, eventType: 'security.user.revoked', occurredAt: new Date().toISOString(), aggregateType: 'User', aggregateId: targetUserId, data: { reason } } } });
      return { revokedSessions: revoked.count, authorizationVersion: target.authorizationVersion + 1 };
    });
  }
  async linkIdentity(ctx: AccessContext, idToken: string) {
    if (ctx.permissions.some(p => p.startsWith('admin:')) && ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Admin linking requires step-up' });
    let payload: any;
    try { const r = await jwtVerify(idToken, this.keySet(), { issuer: this.env.KEYCLOAK_ISSUER, audience: this.env.KEYCLOAK_CLIENT_ID }); payload = r.payload; }
    catch { throw new UnauthorizedException({ code: 'OIDC_VERIFICATION_FAILED', message: 'Provider token verification failed' }); }
    const issuer = String(payload.iss), subject = String(payload.sub);
    if (!subject) throw new UnauthorizedException({ code: 'OIDC_VERIFICATION_FAILED', message: 'Missing subject' });
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const existing = await tx.userIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } });
      if (existing && existing.userId !== ctx.userId) throw new ConflictException({ code: 'IDENTITY_ALREADY_LINKED', message: 'Provider identity belongs to another account' });
      if (existing) { await tx.userIdentity.update({ where: { id: existing.id }, data: { lastVerifiedAt: new Date() } }); return; }
      const sameIssuer = await tx.userIdentity.findFirst({ where: { userId: ctx.userId, issuer } });
      if (sameIssuer) throw new ConflictException({ code: 'ISSUER_ALREADY_LINKED', message: 'This provider is already linked' });
      await tx.userIdentity.create({ data: { userId: ctx.userId, issuer, subject, providerKey: 'keycloak', providerEmailVerified: payload['email_verified'] === true, lastVerifiedAt: new Date() } });
      await this.audit(tx, ctx, 'security.identity.linked', 'UserIdentity', ctx.userId);
    });
    return { linked: true, issuer };
  }
}
