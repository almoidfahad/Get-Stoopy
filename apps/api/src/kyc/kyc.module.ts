import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
@Module({ imports: [AuthModule], controllers: [KycController], providers: [KycService], exports: [KycService] })
export class KycModule {}
