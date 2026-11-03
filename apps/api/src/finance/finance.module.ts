import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PayoutDestinationsService } from './payout-destinations.service.js';
import { PayoutDestinationsController } from './payout-destinations.controller.js';
@Module({ imports: [AuthModule], controllers: [FinanceController, PayoutDestinationsController], providers: [FinanceService, PayoutDestinationsService], exports: [FinanceService, PayoutDestinationsService] })
export class FinanceModule {}
