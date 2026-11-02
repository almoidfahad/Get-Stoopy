import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { CatalogService } from './catalog.service.js';
import type { AccessContext } from '@getstoopy/core';

class CreateStoreDto {
  @IsUUID() vendorId!: string;
  @IsUUID() cityId!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(140) slug!: string;
  @IsString() @MinLength(5) @MaxLength(500) addressLine!: string;
}
class StoreDecisionDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class CreateProductDto {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MinLength(10) @MaxLength(5000) description!: string;
  @IsOptional() @IsString() @MaxLength(120) brand?: string;
}
class ArchiveProductDto {
  @IsInt() @Min(1) version!: number;
}
class CreateVariantDto {
  @IsString() @MinLength(1) @MaxLength(120) sku!: string;
  @IsObject() optionValues!: Record<string, unknown>;
  @IsString() @Matches(/^(0|[1-9][0-9]*)$/) priceAmountMinor!: string;
  @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]*)$/) compareAtAmountMinor?: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @IsInt() @Min(1) weightGrams?: number;
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('stores') @UseGuards(SessionGuard, CsrfGuard)
  createStore(@Req() req: Request, @Body() body: CreateStoreDto) { return this.catalog.createStore(this.ctx(req), body); }
  @Get('stores') @UseGuards(SessionGuard)
  listStores(@Req() req: Request, @Query('vendorId', ParseUUIDPipe) vendorId: string) { return this.catalog.listStores(this.ctx(req), vendorId); }
  @Post('admin/stores/:id/activate') @UseGuards(SessionGuard, CsrfGuard)
  activateStore(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreDecisionDto) { return this.catalog.activateStore(this.ctx(req), id, body); }
  @Post('admin/stores/:id/suspend') @UseGuards(SessionGuard, CsrfGuard)
  suspendStore(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreDecisionDto) { return this.catalog.suspendStore(this.ctx(req), id, body); }

  @Post('stores/:storeId/products') @UseGuards(SessionGuard, CsrfGuard)
  createProduct(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: CreateProductDto) { return this.catalog.createProduct(this.ctx(req), storeId, body); }
  @Get('stores/:storeId/products') @UseGuards(SessionGuard)
  listProducts(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string) { return this.catalog.listProducts(this.ctx(req), storeId); }
  @Post('products/:id/archive') @UseGuards(SessionGuard, CsrfGuard)
  archiveProduct(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ArchiveProductDto) { return this.catalog.archiveProduct(this.ctx(req), id, body.version); }
  @Post('products/:id/variants') @UseGuards(SessionGuard, CsrfGuard)
  createVariant(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateVariantDto) { return this.catalog.createVariant(this.ctx(req), id, body); }
  @Get('products/:id/variants') @UseGuards(SessionGuard)
  listVariants(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.catalog.listVariants(this.ctx(req), id); }
}
