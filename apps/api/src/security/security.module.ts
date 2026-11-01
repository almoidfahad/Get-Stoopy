import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SecurityController } from './security.controller.js';
import { SecurityService } from './security.service.js';
@Module({ imports: [AuthModule], controllers: [SecurityController], providers: [SecurityService], exports: [SecurityService] })
export class SecurityModule {}
