import { Inject, Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { LocalEncryptedObjectStorage, signStorageToken, verifyStorageToken, assertMagicContentType } from '@getstoopy/storage';
import { hasPermission, inGeographicScope, type AccessContext } from '@getstoopy/core';

const ALLOWED_TYPES = new Map<string, string[]>([
  ['kyc-document', ['image/png', 'image/jpeg', 'application/pdf']],
  ['profile-avatar', ['image/png', 'image/jpeg', 'image/webp']],
  ['product-image', ['image/png', 'image/jpeg', 'image/webp']]
]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BYTES_BY_PURPOSE: Record<string, number> = { 'product-image': 5 * 1024 * 1024 };
const REVIEW_PERMISSION = 'storage:kyc:review';

@Injectable()
export class StorageService {
  private storage: LocalEncryptedObjectStorage;
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {
    this.storage = new LocalEncryptedObjectStorage(env.STORAGE_LOCAL_DIR, env.STORAGE_ENCRYPTION_KEY);
  }
  private async audit(tx: any, ctx: AccessContext, action: string, resourceId: string, reason?: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot",reason,"requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, 'StorageObject', ${resourceId}::uuid, '{}'::jsonb, ${reason ?? null}, ${randomUUID()})`;
  }
  private requireReviewer(ctx: AccessContext) {
    if (!hasPermission(ctx, REVIEW_PERMISSION)) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Storage review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
  }
  async createUpload(ctx: AccessContext, input: { purpose: string; contentType: string; sizeBytes: number }) {
    const allowed = ALLOWED_TYPES.get(input.purpose);
    if (!allowed) throw new BadRequestException({ code: 'PURPOSE_NOT_ALLOWED', message: 'Storage purpose is not allowed' });
    if (!allowed.includes(input.contentType)) throw new BadRequestException({ code: 'CONTENT_TYPE_NOT_ALLOWED', message: 'Content type is not allowed for this purpose' });
    const maxBytes = MAX_BYTES_BY_PURPOSE[input.purpose] ?? MAX_BYTES;
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > maxBytes) throw new BadRequestException({ code: 'SIZE_NOT_ALLOWED', message: 'Object size is not allowed' });
    const id = randomUUID(); const objectKey = `${input.purpose}/${ctx.userId}/${id}`;
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      await tx.storageObject.create({ data: { id, ownerUserId: ctx.userId, purpose: input.purpose, objectKey, contentType: input.contentType, sizeBytes: BigInt(input.sizeBytes), state: 'PENDING_UPLOAD', encryptionKeyId: 'local-dev-aes-256-gcm', expiresAt: new Date(Date.now() + 24 * 3600_000) } });
      await this.audit(tx, ctx, 'storage.upload.created', id);
    });
    const token = signStorageToken({ objectId: id, action: 'upload', exp: Date.now() + 10 * 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
    return { objectId: id, uploadUrl: `/api/v1/storage/uploads/${id}`, token, expiresIn: 600, maxBytes };
  }
  private verifyToken(token: string, objectId: string, action: 'upload' | 'download' | 'review-download') {
    try { const payload = verifyStorageToken(token, this.env.STORAGE_ENCRYPTION_KEY); if (payload.objectId !== objectId || payload.action !== action) throw new Error('denied'); return payload; }
    catch { throw new ForbiddenException({ code: 'STORAGE_TOKEN_DENIED', message: 'Storage token is invalid or expired' }); }
  }
  async upload(ctx: AccessContext, objectId: string, token: string, req: Request) {
    this.verifyToken(token, objectId, 'upload');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += b.length; if (size > MAX_BYTES) throw new BadRequestException({ code: 'SIZE_NOT_ALLOWED', message: 'Object exceeds maximum size' }); chunks.push(b); }
    const data = Buffer.concat(chunks);
    if (data.length === 0) throw new BadRequestException({ code: 'EMPTY_OBJECT', message: 'Object body is empty' });
    const result = await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const obj = await tx.storageObject.findFirst({ where: { id: objectId, ownerUserId: ctx.userId } });
      if (!obj) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
      if (obj.state !== 'PENDING_UPLOAD') throw new BadRequestException({ code: 'OBJECT_NOT_PENDING', message: 'Object is not pending upload' });
      if (Number(obj.sizeBytes) !== data.length) throw new BadRequestException({ code: 'SIZE_MISMATCH', message: 'Uploaded size does not match request' });
      try { assertMagicContentType(data, obj.contentType); }
      catch { throw new BadRequestException({ code: 'CONTENT_TYPE_MISMATCH', message: 'Object content does not match the declared type' }); }
      const meta = await this.storage.put(obj.objectKey, data, obj.contentType);
      const state = obj.purpose === 'kyc-document' || obj.purpose === 'product-image' ? 'QUARANTINED' : 'UPLOADED';
      await tx.storageObject.update({ where: { id: objectId }, data: { state, magicValid: true, sha256: meta.sha256, sizeBytes: BigInt(meta.sizeBytes), encryptionKeyId: meta.encryptionKeyId, ...(obj.purpose === 'product-image' ? { expiresAt: null } : {}) } });
      await this.audit(tx, ctx, 'storage.upload.completed', objectId);
      return { objectId, state };
    });
    return result;
  }
  async createDownload(ctx: AccessContext, objectId: string) {
    const obj = await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const found = await tx.storageObject.findFirst({ where: { id: objectId, ownerUserId: ctx.userId } });
      if (!found) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
      if (found.state !== 'UPLOADED') throw new BadRequestException({ code: 'OBJECT_NOT_READY', message: 'Object is not ready' });
      await this.audit(tx, ctx, 'storage.download.issued', objectId);
      return found;
    });
    const token = signStorageToken({ objectId, action: 'download', exp: Date.now() + 5 * 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
    return { objectId, downloadUrl: `/api/v1/storage/downloads/${objectId}?token=${encodeURIComponent(token)}`, expiresIn: 300, contentType: obj.contentType };
  }
  async createReviewDownload(ctx: AccessContext, objectId: string) {
    this.requireReviewer(ctx);
    const obj = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const found = await tx.storageObject.findUnique({ where: { id: objectId } });
      if (!found || found.purpose !== 'kyc-document') throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
      if (found.state !== 'QUARANTINED') throw new BadRequestException({ code: 'OBJECT_NOT_QUARANTINED', message: 'Object is not quarantined' });
      await this.audit(tx, ctx, 'storage.review.download.issued', objectId);
      return found;
    });
    const token = signStorageToken({ objectId, action: 'review-download', exp: Date.now() + 5 * 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
    return { objectId, downloadUrl: `/api/v1/storage/downloads/${objectId}?token=${encodeURIComponent(token)}`, expiresIn: 300, contentType: obj.contentType };
  }
  async review(ctx: AccessContext, objectId: string, input: { decision: 'approve' | 'reject'; reason: string }) {
    this.requireReviewer(ctx);
    if (!['approve', 'reject'].includes(input.decision)) throw new BadRequestException({ code: 'DECISION_INVALID', message: 'Review decision is invalid' });
    if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 512) throw new BadRequestException({ code: 'REVIEW_REASON_REQUIRED', message: 'A review reason is required' });
    return this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const obj = await tx.storageObject.findUnique({ where: { id: objectId } });
      if (!obj || obj.purpose !== 'kyc-document') throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
      if (obj.ownerUserId === ctx.userId) throw new ForbiddenException({ code: 'SELF_REVIEW_DENIED', message: 'Reviewer cannot review their own object' });
      if (obj.state !== 'QUARANTINED') throw new BadRequestException({ code: 'OBJECT_NOT_QUARANTINED', message: 'Object is not quarantined' });
      const state = input.decision === 'approve' ? 'UPLOADED' : 'DELETED';
      const updated = await tx.storageObject.update({ where: { id: objectId }, data: { state, reviewedByUserId: ctx.userId, reviewedAt: new Date(), reviewReason: input.reason.trim(), ...(state === 'DELETED' ? { deletedAt: new Date() } : {}) } });
      await this.audit(tx, ctx, `storage.review.${input.decision}`, objectId, input.reason.trim());
      return { objectId, state: updated.state, reviewedAt: updated.reviewedAt };
    });
  }
  async download(objectId: string, token: string) {
    let payload;
    try { payload = verifyStorageToken(token, this.env.STORAGE_ENCRYPTION_KEY); }
    catch { throw new ForbiddenException({ code: 'STORAGE_TOKEN_DENIED', message: 'Storage token is invalid or expired' }); }
    if (payload.objectId !== objectId || !['download', 'review-download'].includes(payload.action)) throw new ForbiddenException({ code: 'STORAGE_TOKEN_DENIED', message: 'Storage token is invalid or expired' });
    const row = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      return tx.storageObject.findUnique({ where: { id: objectId } });
    });
    if (!row) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
    if (payload.action === 'download' && row.state !== 'UPLOADED') throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
    if (payload.action === 'review-download' && (row.state !== 'QUARANTINED' || !['kyc-document', 'product-image'].includes(row.purpose))) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
    const data = await this.storage.get(row.objectKey);
    return { data, contentType: row.contentType };
  }
  async createProductImageReviewDownload(ctx: AccessContext, imageId: string) {
    if (!hasPermission(ctx, 'catalog:product-image:review')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Product image review permission is required' });
    if (ctx.assurance !== 'STEP_UP') throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Recent step-up is required' });
    const obj = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion, isSuper: true });
      const image = await tx.productImage.findUnique({ where: { id: imageId }, include: { storageObject: true } });
      if (!image || image.state !== 'PENDING_REVIEW' || image.storageObject.purpose !== 'product-image' || image.storageObject.state !== 'QUARANTINED') throw new NotFoundException({ code: 'PRODUCT_IMAGE_NOT_FOUND', message: 'Product image not found' });
      if (!inGeographicScope(ctx, { countryId: image.countryId })) throw new NotFoundException({ code: 'PRODUCT_IMAGE_NOT_FOUND', message: 'Product image not found' });
      await this.audit(tx, ctx, 'catalog.product-image.review.download.issued', image.id);
      return image.storageObject;
    });
    const token = signStorageToken({ objectId: obj.id, action: 'review-download', exp: Date.now() + 5 * 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
    return { imageId, downloadUrl: `/api/v1/storage/downloads/${obj.id}?token=${encodeURIComponent(token)}`, expiresIn: 300, contentType: obj.contentType };
  }
  async readApprovedProductImage(objectId: string) {
    const row = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      return tx.storageObject.findUnique({ where: { id: objectId } });
    });
    if (!row || row.purpose !== 'product-image' || row.state !== 'UPLOADED' || !row.magicValid || row.deletedAt) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
    const data = await this.storage.get(row.objectKey);
    return { data, contentType: row.contentType };
  }
}
