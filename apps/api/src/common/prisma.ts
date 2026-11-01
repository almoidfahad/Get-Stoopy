import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
@Injectable()
export class PrivilegedPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { const url = process.env['DATABASE_PRIVILEGED_URL']; if (!url) throw new Error('DATABASE_PRIVILEGED_URL_REQUIRED'); super({ datasources: { db: { url } } }); }
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
export interface RlsActor { userId: string; authorizationVersion: number; isSuper?: boolean; }
export async function setRls(tx: any, actor: RlsActor): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.user_id', ${actor.userId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.auth_version', ${String(actor.authorizationVersion)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_super', ${actor.isSuper ? 'true' : 'false'}, true)`;
}
