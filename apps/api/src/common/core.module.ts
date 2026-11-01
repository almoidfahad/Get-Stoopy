import { Global, Module } from '@nestjs/common';
import { provideEnv } from './env.js';
import { PrismaService, PrivilegedPrismaService } from './prisma.js';
@Global()
@Module({ providers: [provideEnv(), PrismaService, PrivilegedPrismaService], exports: [provideEnv(), PrismaService, PrivilegedPrismaService] })
export class CoreModule {}
