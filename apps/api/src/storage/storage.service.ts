import { Inject, Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService, PrivilegedPrismaService, setRls } from '../common/prisma.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { LocalEncryptedObjectStorage, signStorageToken, verifyStorageToken } from '@getstoopy/storage';
import type { AccessContext } from '@getstoopy/core';
const ALLOWED_TYPES = new Map<string, string[]>([
  ['kyc-document', ['image/png', 'image/jpeg', 'application/pdf']],
  ['profile-avatar', ['image/png', 'image/jpeg', 'image/webp']]
]);
const MAX_BYTES = 10 * 1024 * 1024;
@Injectable()
export class StorageService {
  private storage: LocalEncryptedObjectStorage;
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(PrivilegedPrismaService) private readonly privileged: PrivilegedPrismaService, @Inject(ENV) private readonly env: ApiEnv) {
    this.storage = new LocalEncryptedObjectStorage(env.STORAGE_LOCAL_DIR, env.STORAGE_ENCRYPTION_KEY);
  }
  private async audit(tx: any, ctx: AccessContext, action: string, resourceId: string) {
    await tx.$executeRaw`INSERT INTO "AuditLog"(id,"actorId","actorType","sessionId",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES (gen_random_uuid(), ${ctx.userId}::uuid, 'USER', ${ctx.sessionId}::uuid, ${action}, 'StorageObject', ${resourceId}::uuid, '{}'::jsonb, ${randomUUID()})`;
  }
  async createUpload(ctx: AccessContext, input: { purpose: string; contentType: string; sizeBytes: number }) {
    const allowed = ALLOWED_TYPES.get(input.purpose);
    if (!allowed) throw new BadRequestException({ code: 'PURPOSE_NOT_ALLOWED', message: 'Storage purpose is not allowed' });
    if (!allowed.includes(input.contentType)) throw new BadRequestException({ code: 'CONTENT_TYPE_NOT_ALLOWED', message: 'Content type is not allowed for this purpose' });
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) throw new BadRequestException({ code: 'SIZE_NOT_ALLOWED', message: 'Object size is not allowed' });
    const id = randomUUID(); const objectKey = `${input.purpose}/${ctx.userId}/${id}`;
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      await tx.storageObject.create({ data: { id, ownerUserId: ctx.userId, purpose: input.purpose, objectKey, contentType: input.contentType, sizeBytes: BigInt(input.sizeBytes), state: 'PENDING_UPLOAD', encryptionKeyId: 'local-dev-aes-256-gcm', expiresAt: new Date(Date.now() + 24 * 3600_000) } });
      await this.audit(tx, ctx, 'storage.upload.created', id);
    });
    const token = signStorageToken({ objectId: id, action: 'upload', exp: Date.now() + 10 * 60_000 }, this.env.STORAGE_ENCRYPTION_KEY);
    return { objectId: id, uploadUrl: `/api/v1/storage/uploads/${id}`, token, expiresIn: 600, maxBytes: MAX_BYTES };
  }
  private verifyToken(token: string, objectId: string, action: 'upload' | 'download') {
    try { const payload = verifyStorageToken(token, this.env.STORAGE_ENCRYPTION_KEY); if (payload.objectId !== objectId || payload.action !== action) throw new Error('denied'); return payload; }
    catch { throw new ForbiddenException({ code: 'STORAGE_TOKEN_DENIED', message: 'Storage token is invalid or expired' }); }
  }
  async upload(ctx: AccessContext, objectId: string, token: string, req: Request) {
    this.verifyToken(token, objectId, 'upload');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += b.length; if (size > MAX_BYTES) throw new BadRequestException({ code: 'SIZE_NOT_ALLOWED', message: 'Object exceeds maximum size' }); chunks.push(b); }
    const data = Buffer.concat(chunks);
    if (data.length === 0) throw new BadRequestException({ code: 'EMPTY_OBJECT', message: 'Object body is empty' });
    await this.db.$transaction(async tx => {
      await setRls(tx, { userId: ctx.userId, authorizationVersion: ctx.authorizationVersion });
      const obj = await tx.storageObject.findFirst({ where: { id: objectId, ownerUserId: ctx.userId } });
      if (!obj) throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
      if (obj.state !== 'PENDING_UPLOAD') throw new BadRequestException({ code: 'OBJECT_NOT_PENDING', message: 'Object is not pending upload' });
      if (Number(obj.sizeBytes) !== data.length) throw new BadRequestException({ code: 'SIZE_MISMATCH', message: 'Uploaded size does not match request' });
      const meta = await this.storage.put(obj.objectKey, data, obj.contentType);
      await tx.storageObject.update({ where: { id: objectId }, data: { state: 'UPLOADED', sha256: meta.sha256, sizeBytes: BigInt(meta.sizeBytes), encryptionKeyId: meta.encryptionKeyId } });
      await this.audit(tx, ctx, 'storage.upload.completed', objectId);
    });
    return { objectId, state: 'UPLOADED' };
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
  async download(objectId: string, token: string) {
    this.verifyToken(token, objectId, 'download');
    const row = await this.privileged.$transaction(async tx => {
      await setRls(tx, { userId: '00000000-0000-0000-0000-000000000000', authorizationVersion: 0, isSuper: true });
      return tx.storageObject.findUnique({ where: { id: objectId } });
    });
    if (!row || row.state !== 'UPLOADED') throw new NotFoundException({ code: 'OBJECT_NOT_FOUND', message: 'Storage object not found' });
    const data = await this.storage.get(row.objectKey);
    return { data, contentType: row.contentType };
  }
}
