import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CatalogController, PublicCatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({ imports: [AuthModule, StorageModule], controllers: [CatalogController, PublicCatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
