import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FulfillmentController } from './fulfillment.controller.js';
import { FulfillmentService } from './fulfillment.service.js';

@Module({ imports: [AuthModule], controllers: [FulfillmentController], providers: [FulfillmentService], exports: [FulfillmentService] })
export class FulfillmentModule {}
