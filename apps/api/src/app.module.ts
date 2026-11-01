import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './common/core.module.js';
import { StableExceptionFilter } from './common/errors.js';
import { RequestContextMiddleware } from './common/request-context.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
@Module({
  imports: [CoreModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), HealthModule, AuthModule, AdminModule],
  providers: [{ provide: APP_FILTER, useClass: StableExceptionFilter }]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(RequestContextMiddleware).forRoutes('{*path}'); }
}
