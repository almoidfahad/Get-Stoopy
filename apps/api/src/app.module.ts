import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CoreModule } from './common/core.module.js';
import { StableExceptionFilter } from './common/errors.js';
import { RequestContextMiddleware } from './common/request-context.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { SecurityModule } from './security/security.module.js';
import { StorageModule } from './storage/storage.module.js';
import { KycModule } from './kyc/kyc.module.js';
import { PartyModule } from './party/party.module.js';
@Module({
  imports: [CoreModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), HealthModule, AuthModule, AdminModule, SecurityModule, StorageModule, KycModule, PartyModule],
  providers: [{ provide: APP_FILTER, useClass: StableExceptionFilter }, { provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(RequestContextMiddleware).forRoutes('{*path}'); }
}
