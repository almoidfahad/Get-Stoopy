import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogController, PublicCatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({ imports: [AuthModule], controllers: [CatalogController, PublicCatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
