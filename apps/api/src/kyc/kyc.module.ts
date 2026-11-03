import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { KycRetentionService } from './kyc-retention.service.js';
import { KycRetentionController } from './kyc-retention.controller.js';
@Module({ imports: [AuthModule], controllers: [KycController, KycRetentionController], providers: [KycService, KycRetentionService], exports: [KycService, KycRetentionService] })
export class KycModule {}
