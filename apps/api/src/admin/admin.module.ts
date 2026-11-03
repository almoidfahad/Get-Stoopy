import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminActivationService } from './admin-activation.service.js';
import { AdminActivationController } from './admin-activation.controller.js';
@Module({ imports: [AuthModule], controllers: [AdminController, AdminActivationController], providers: [AdminActivationService], exports: [AdminActivationService] })
export class AdminModule {}
