import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentsController } from './payments.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
@Module({ imports: [AuthModule, InventoryModule], controllers: [PaymentsController], providers: [OrdersService, PaymentsService], exports: [OrdersService, PaymentsService] })
export class PaymentsModule {}
