import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RiskCasesController } from './risk-cases.controller.js';
import { RiskCasesService } from './risk-cases.service.js';
import { RiskSignalProducerService } from './risk-signal-producer.service.js';
@Module({ imports: [AuthModule], controllers: [RiskCasesController], providers: [RiskCasesService, RiskSignalProducerService], exports: [RiskCasesService, RiskSignalProducerService] })
export class RiskModule {}
