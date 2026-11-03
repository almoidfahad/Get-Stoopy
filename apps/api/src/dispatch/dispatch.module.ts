import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';
@Module({ imports: [AuthModule, FinanceModule], controllers: [DispatchController], providers: [DispatchService], exports: [DispatchService] })
export class DispatchModule {}
