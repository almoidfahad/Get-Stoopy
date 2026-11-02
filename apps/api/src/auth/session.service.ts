import { Inject, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { hashToken, newOpaqueToken, sessionExpiry, sessionValid } from '@getstoopy/auth';
import { encryptJson, csrfTokenForSession } from '@getstoopy/bff';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isPartyActiveWithKyc, vendorMembershipPermissions, type AccessContext, type VendorMembershipRole } from '@getstoopy/core';
@Injectable()
export class SessionService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {}
  private keySet() {
    if (!this.jwks) this.jwks = createRemoteJWKSet(new URL(`${this.env.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`));
    return this.jwks;
  }
  async createFromIdToken(input: { idToken: string; accessToken?: string; refreshToken?: string; providerExpiresAt?: string }) {
    let payload: any;
    try {
      const result = await jwtVerify(input.idToken, this.keySet(), { issuer: this.env.KEYCLOAK_ISSUER, audience: this.env.KEYCLOAK_CLIENT_ID });
      payload = result.payload;
    } catch { throw new UnauthorizedException({ code: 'OIDC_VERIFICATION_FAILED', message: 'Identity token verification failed' }); }
    const issuer = String(payload.iss); const subject = String(payload.sub);
    if (!subject) throw new UnauthorizedException({ code: 'OIDC_VERIFICATION_FAILED', message: 'Missing subject' });
    const email = typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null;
    const emailVerified = payload['email_verified'] === true;
    const displayName = typeof payload['name'] === 'string' ? payload['name'].slice(0, 120) : 'Get Stoopy User';
    const token = newOpaqueToken(); const tokenHash = hashToken(token);
    const now = new Date(); const expiry = sessionExpiry(now, { idleMinutes: this.env.SESSION_IDLE_MINUTES, absoluteHours: this.env.PRIVILEGED_ABSOLUTE_HOURS });
    const envelope = encryptJson({ accessToken: input.accessToken, refreshToken: input.refreshToken, providerExpiresAt: input.providerExpiresAt }, this.env.SESSION_TOKEN_ENCRYPTION_KEY);
    const user = await this.privileged.$transaction(async (tx) => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      const identity = await tx.userIdentity.findUnique({ where: { issuer_subject: { issuer, subject } }, include: { user: true } });
      if (identity) {
        if (identity.user.status !== 'ACTIVE') throw new UnauthorizedException({ code: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
        await tx.userIdentity.update({ where: { id: identity.id }, data: { lastVerifiedAt: now, providerEmailVerified: emailVerified } });
        return identity.user;
      }
      if (email && emailVerified) {
        const existing = await tx.user.findUnique({ where: { emailNormalized: email } });
        if (existing) throw new ConflictException({ code: 'ACCOUNT_LINKING_REQUIRED', message: 'Existing account requires approved linking' });
      }
      const created = await tx.user.create({ data: { emailNormalized: emailVerified ? email : null, emailVerifiedAt: emailVerified ? now : null, displayName } });
      await tx.userIdentity.create({ data: { userId: created.id, issuer, subject, providerKey: 'keycloak', providerEmailVerified: emailVerified, lastVerifiedAt: now } });
      return created;
    });
    await this.privileged.$transaction(async (tx) => {
      await setRls(tx, { userId: user.id, authorizationVersion: user.authorizationVersion, isSuper: true });
      await tx.session.create({ data: { userId: user.id, tokenHash, assuranceLevel: 'PASSWORD', state: 'ACTIVE', encryptedTokenEnvelope: Buffer.from(envelope), expiresAt: expiry.expiresAt, idleExpiresAt: expiry.idleExpiresAt, authVersion: user.authorizationVersion } });
    });
    return { sessionToken: token, csrfToken: csrfTokenForSession(token), expiresAt: expiry.expiresAt.toISOString(), idleExpiresAt: expiry.idleExpiresAt.toISOString(), user: { id: user.id, displayName: user.displayName } };
  }
  async resolve(token: string): Promise<{ context: AccessContext; sessionToken: string }> {
    const tokenHash = hashToken(token);
    const result = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.session_token_hash', ${tokenHash}, true)`;
      const session = await tx.session.findUnique({ where: { tokenHash } });
      if (!session || session.state !== 'ACTIVE' || !sessionValid(new Date(), session.idleExpiresAt, session.expiresAt, session.revokedAt ?? undefined)) return null;
      await setRls(tx, { userId: session.userId, authorizationVersion: session.authVersion });
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (!user || user.status !== 'ACTIVE' || session.authVersion !== user.authorizationVersion) return null;
      let assurance = session.assuranceLevel;
      if (assurance === 'STEP_UP' && (!session.stepUpExpiresAt || session.stepUpExpiresAt <= new Date())) { assurance = 'MFA'; await tx.session.update({ where: { id: session.id }, data: { assuranceLevel: 'MFA', stepUpExpiresAt: null } }); }
      const idle = sessionExpiry(new Date(), { idleMinutes: this.env.SESSION_IDLE_MINUTES, absoluteHours: this.env.PRIVILEGED_ABSOLUTE_HOURS });
      const nextIdle = new Date(Math.min(idle.idleExpiresAt.getTime(), session.expiresAt.getTime()));
      await tx.session.update({ where: { id: session.id }, data: { idleExpiresAt: nextIdle } });
      const roles = await tx.userRole.findMany({ where: { userId: session.userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
      const scopes = await tx.adminScope.findMany({ where: { userId: session.userId, revokedAt: null, effectiveFrom: { lte: new Date() }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      const permissions = [...new Set(roles.flatMap(r => r.role.permissions.map(p => p.permission.key)))];
      return { session, user, permissions, scopes, assurance };
    });
    if (!result) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Session is invalid or expired' });
    const party = await this.resolvePartyContext(result.user.id);
    const context: AccessContext = {
      userId: result.user.id, sessionId: result.session.id, authorizationVersion: result.user.authorizationVersion,
      accountStatus: result.user.status as any, assurance: result.assurance as any,
      permissions: result.permissions, scopes: result.scopes.map(s => ({
        id: s.id, type: s.geographyType as any, countryId: s.countryId ?? '',
        ...(s.regionId ? { regionId: s.regionId } : {}), ...(s.districtId ? { districtId: s.districtId } : {}),
        ...(s.cityId ? { cityId: s.cityId } : {}), ...(s.serviceZoneId ? { zoneId: s.serviceZoneId } : {}),
        ...(s.neighborhoodId ? { neighborhoodId: s.neighborhoodId } : {}),
        ...(s.expiresAt ? { expiresAt: s.expiresAt.toISOString() } : {}), ...(s.revokedAt ? { revokedAt: s.revokedAt.toISOString() } : {})
      })),
      vendorMemberships: party.vendorMemberships, ...(party.riderId ? { riderId: party.riderId } : {}), now: new Date().toISOString()
    };
    return { context, sessionToken: token };
  }
  private async resolvePartyContext(userId: string): Promise<{ vendorMemberships: AccessContext['vendorMemberships']; riderId?: string }> {
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId, authorizationVersion: 0, isSuper: true });
      const now = new Date();
      const memberships = await tx.vendorMembership.findMany({
        where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], vendor: { status: 'ACTIVE', kycCaseId: { not: null } } },
        include: { vendor: { include: { kycCase: true } } }
      });
      const vendorMemberships = memberships
        .filter(m => {
          const k = m.vendor.kycCase;
          return !!k && k.subjectUserId === m.vendor.ownerUserId && k.countryId === m.vendor.countryId && isPartyActiveWithKyc({ status: m.vendor.status, countryId: m.vendor.countryId, kycCase: k }, 'VENDOR', m.vendor.countryId, now);
        })
        .map(m => ({ vendorId: m.vendorId, countryId: m.vendor.countryId, permissions: vendorMembershipPermissions(m.role as VendorMembershipRole) }));
      const rider = await tx.riderProfile.findUnique({ where: { userId }, include: { kycCase: true } });
      const riderEligible = !!rider && !!rider.kycCase && rider.kycCase.subjectUserId === rider.userId && rider.kycCase.countryId === rider.countryId && isPartyActiveWithKyc({ status: rider.status, countryId: rider.countryId, kycCase: rider.kycCase }, 'RIDER', rider.countryId, now);
      return { vendorMemberships, ...(riderEligible && rider ? { riderId: rider.id } : {}) };
    });
  }
  async revoke(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.session_token_hash', ${tokenHash}, true)`;
      const session = await tx.session.findUnique({ where: { tokenHash } });
      if (!session) return;
      await setRls(tx, { userId: session.userId, authorizationVersion: session.authVersion });
      await tx.session.update({ where: { id: session.id }, data: { state: 'REVOKED', revokedAt: new Date() } });
    });
  }
}
