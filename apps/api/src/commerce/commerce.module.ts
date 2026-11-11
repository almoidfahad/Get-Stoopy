import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CommerceController } from './commerce.controller.js';
import { CommerceService } from './commerce.service.js';
import { RecipientDraftService } from './recipient-draft.service.js';
@Module({ imports: [AuthModule, InventoryModule], controllers: [CommerceController], providers: [CommerceService, RecipientDraftService], exports: [CommerceService] })
export class CommerceModule {}
