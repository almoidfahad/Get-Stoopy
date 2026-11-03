import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PayoutDestinationsService } from './payout-destinations.service.js';
import { PayoutDestinationsController } from './payout-destinations.controller.js';
import { VendorSettlementsService } from './vendor-settlements.service.js';
import { VendorSettlementsController } from './vendor-settlements.controller.js';
import { FinanceOperationsService } from './finance-operations.service.js';
import { SandboxPayoutAdapter } from './sandbox-payout.adapter.js';
import { FinanceOperationsController } from './finance-operations.controller.js';
@Module({ imports: [AuthModule], controllers: [FinanceController, PayoutDestinationsController, VendorSettlementsController, FinanceOperationsController], providers: [FinanceService, PayoutDestinationsService, VendorSettlementsService, FinanceOperationsService, SandboxPayoutAdapter], exports: [FinanceService, PayoutDestinationsService, VendorSettlementsService, FinanceOperationsService, SandboxPayoutAdapter] })
export class FinanceModule {}
