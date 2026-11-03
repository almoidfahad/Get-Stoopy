import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PayoutDestinationsService } from './payout-destinations.service.js';
import { PayoutDestinationsController } from './payout-destinations.controller.js';
import { VendorSettlementsService } from './vendor-settlements.service.js';
import { VendorSettlementsController } from './vendor-settlements.controller.js';
@Module({ imports: [AuthModule], controllers: [FinanceController, PayoutDestinationsController, VendorSettlementsController], providers: [FinanceService, PayoutDestinationsService, VendorSettlementsService], exports: [FinanceService, PayoutDestinationsService, VendorSettlementsService] })
export class FinanceModule {}
