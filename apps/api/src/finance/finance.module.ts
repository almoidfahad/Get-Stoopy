import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
@Module({ imports: [AuthModule], controllers: [FinanceController], providers: [FinanceService], exports: [FinanceService] })
export class FinanceModule {}
