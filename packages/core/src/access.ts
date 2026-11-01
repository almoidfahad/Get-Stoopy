export type GeographyType = 'COUNTRY' | 'REGION' | 'DISTRICT' | 'CITY' | 'ZONE' | 'NEIGHBORHOOD';
export type Assurance = 'PASSWORD' | 'MFA' | 'STEP_UP';
export interface GeoPath { countryId: string; regionId?: string; districtId?: string; cityId?: string; zoneId?: string; neighborhoodId?: string; }
export interface ScopeGrant extends GeoPath { id: string; type: GeographyType; expiresAt?: string; revokedAt?: string; }
export interface VendorMembership { vendorId: string; storeId?: string; permissions: string[]; }
export interface AccessContext {
  userId: string; sessionId: string; authorizationVersion: number; accountStatus: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  assurance: Assurance; permissions: string[]; scopes: ScopeGrant[]; vendorMemberships: VendorMembership[];
  riderId?: string; customerId?: string; now: string;
}
export interface ResourceScope extends GeoPath { ownerUserId?: string; vendorId?: string; storeId?: string; riderId?: string; customerId?: string; }
export type Decision = { allow: true } | { allow: false; reason: string };
const deny = (reason: string): Decision => ({ allow: false, reason });
export function hasPermission(ctx: AccessContext, permission: string): boolean {
  return ctx.permissions.includes(permission) || ctx.permissions.includes('*');
}
export function scopeContains(grant: ScopeGrant, resource: GeoPath): boolean {
  switch (grant.type) {
    case 'COUNTRY': return grant.countryId === resource.countryId;
    case 'REGION': return !!grant.regionId && grant.regionId === resource.regionId && grant.countryId === resource.countryId;
    case 'DISTRICT': return !!grant.districtId && grant.districtId === resource.districtId && grant.countryId === resource.countryId;
    case 'CITY': return !!grant.cityId && grant.cityId === resource.cityId && grant.countryId === resource.countryId;
    case 'ZONE': return !!grant.zoneId && grant.zoneId === resource.zoneId && grant.countryId === resource.countryId;
    case 'NEIGHBORHOOD': return !!grant.neighborhoodId && grant.neighborhoodId === resource.neighborhoodId && grant.countryId === resource.countryId;
  }
}
export function activeScopes(ctx: AccessContext): ScopeGrant[] {
  const now = Date.parse(ctx.now);
  return ctx.scopes.filter(s => !s.revokedAt && (!s.expiresAt || Date.parse(s.expiresAt) > now));
}
export function inGeographicScope(ctx: AccessContext, resource: GeoPath): boolean {
  return activeScopes(ctx).some(s => scopeContains(s, resource));
}
export function authorize(ctx: AccessContext, permission: string, resource: ResourceScope, opts: { requireMfa?: boolean; requireStepUp?: boolean; allowOwner?: boolean; allowVendor?: boolean; allowRider?: boolean } = {}): Decision {
  if (ctx.accountStatus !== 'ACTIVE') return deny('ACCOUNT_INACTIVE');
  if (!hasPermission(ctx, permission)) return deny('PERMISSION_DENIED');
  if (opts.requireMfa && ctx.assurance === 'PASSWORD') return deny('MFA_REQUIRED');
  if (opts.requireStepUp && ctx.assurance !== 'STEP_UP') return deny('STEP_UP_REQUIRED');
  if (opts.allowOwner && resource.ownerUserId === ctx.userId) return { allow: true };
  if (opts.allowRider && ctx.riderId && resource.riderId === ctx.riderId) return { allow: true };
  if (opts.allowVendor && resource.vendorId) {
    const m = ctx.vendorMemberships.find(x => x.vendorId === resource.vendorId && (!x.storeId || x.storeId === resource.storeId));
    if (m && (m.permissions.includes(permission) || m.permissions.includes('*'))) return { allow: true };
  }
  if (!inGeographicScope(ctx, resource)) return deny('GEOGRAPHIC_SCOPE_DENIED');
  return { allow: true };
}
export function canGrantScope(grantor: AccessContext, target: ScopeGrant, targetUserId: string): Decision {
  if (grantor.userId === targetUserId) return deny('SELF_SCOPE_GRANT_DENIED');
  if (!hasPermission(grantor, 'admin:scope:grant')) return deny('PERMISSION_DENIED');
  if (grantor.assurance !== 'STEP_UP') return deny('STEP_UP_REQUIRED');
  const parent = activeScopes(grantor).find(s => scopeContains(s, target));
  if (!parent) return deny('GRANT_OUTSIDE_GRANTOR_SCOPE');
  const rank: Record<GeographyType, number> = { COUNTRY: 0, REGION: 1, DISTRICT: 2, CITY: 3, ZONE: 4, NEIGHBORHOOD: 5 };
  if (rank[target.type] < rank[parent.type]) return deny('CANNOT_ESCALATE_SCOPE');
  return { allow: true };
}
