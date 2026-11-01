import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SessionService } from './session.service.js';
import { SessionGuard } from './session.guard.js';
@Module({ controllers: [AuthController], providers: [SessionService, SessionGuard], exports: [SessionService, SessionGuard] })
export class AuthModule {}
