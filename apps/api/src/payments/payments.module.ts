import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentsController } from './payments.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
import { CancellationsService } from './cancellations.service.js';
@Module({ imports: [AuthModule, InventoryModule, FinanceModule], controllers: [PaymentsController], providers: [OrdersService, PaymentsService, CancellationsService], exports: [OrdersService, PaymentsService, CancellationsService] })
export class PaymentsModule {}
