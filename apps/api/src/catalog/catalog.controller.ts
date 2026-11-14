import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { CatalogService } from './catalog.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { AccessContext } from '@getstoopy/core';
import { optionalPublicSearch, optionalPublicString, optionalPublicUuid } from '../common/public-query.js';

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
class SubmitProductDto {
  @IsInt() @Min(1) version!: number;
}
class ReviewProductDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class PublishProductDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class CreateCategoryDto {
  @IsUUID() countryId!: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(140) slug!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
class CategoryDecisionDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class AssignCategoryDto {
  @IsOptional() @IsUUID() categoryId!: string | null;
  @IsInt() @Min(1) version!: number;
}
class AttachImageDto {
  @IsUUID() storageObjectId!: string;
  @IsString() @MinLength(3) @MaxLength(180) altText!: string;
  @IsInt() @Min(0) sortOrder!: number;
}
class ReviewImageDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService, @Inject(StorageService) private readonly storage: StorageService) {}
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

  @Post('products/:id/submit') @UseGuards(SessionGuard, CsrfGuard)
  submitProduct(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitProductDto) { return this.catalog.submitProduct(this.ctx(req), id, body.version); }
  @Get('admin/products') @UseGuards(SessionGuard)
  moderationQueue(@Req() req: Request, @Query('countryId', ParseUUIDPipe) countryId: string, @Query('moderationState') moderationState?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new BadRequestException({ code: 'LIMIT_INVALID', message: 'limit must be 1-100' });
    if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) throw new BadRequestException({ code: 'CURSOR_INVALID', message: 'Invalid cursor' });
    return this.catalog.moderationQueue(this.ctx(req), countryId, moderationState, parsedLimit, cursor);
  }
  @Post('admin/products/:id/review') @UseGuards(SessionGuard, CsrfGuard)
  reviewProduct(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewProductDto) { return this.catalog.reviewProduct(this.ctx(req), id, body); }
  @Post('admin/products/:id/publish') @UseGuards(SessionGuard, CsrfGuard)
  publishProduct(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: PublishProductDto) { return this.catalog.publishProduct(this.ctx(req), id, body); }
  @Post('admin/products/:id/unpublish') @UseGuards(SessionGuard, CsrfGuard)
  unpublishProduct(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: PublishProductDto) { return this.catalog.unpublishProduct(this.ctx(req), id, body); }

  @Post('admin/categories') @UseGuards(SessionGuard, CsrfGuard)
  createCategory(@Req() req: Request, @Body() body: CreateCategoryDto) { return this.catalog.createCategory(this.ctx(req), body); }
  @Get('admin/categories') @UseGuards(SessionGuard)
  adminCategories(@Req() req: Request, @Query('countryId', ParseUUIDPipe) countryId: string) { return this.catalog.adminCategories(this.ctx(req), countryId); }
  @Post('admin/categories/:id/activate') @UseGuards(SessionGuard, CsrfGuard)
  activateCategory(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CategoryDecisionDto) { return this.catalog.categoryDecision(this.ctx(req), id, body, 'activate'); }
  @Post('admin/categories/:id/suspend') @UseGuards(SessionGuard, CsrfGuard)
  suspendCategory(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CategoryDecisionDto) { return this.catalog.categoryDecision(this.ctx(req), id, body, 'suspend'); }
  @Post('products/:id/category') @UseGuards(SessionGuard, CsrfGuard)
  assignCategory(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignCategoryDto) { return this.catalog.assignProductCategory(this.ctx(req), id, { categoryId: body.categoryId ?? null, version: body.version }); }
  @Post('products/:id/images') @UseGuards(SessionGuard, CsrfGuard)
  attachImage(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachImageDto) { return this.catalog.attachProductImage(this.ctx(req), id, body); }
  @Get('products/:id/images') @UseGuards(SessionGuard)
  listImages(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.catalog.listProductImages(this.ctx(req), id); }
  @Post('admin/product-images/:id/review') @UseGuards(SessionGuard, CsrfGuard)
  reviewImage(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewImageDto) { return this.catalog.reviewProductImage(this.ctx(req), id, body); }
  @Post('admin/product-images/:id/review-download-url') @UseGuards(SessionGuard, CsrfGuard)
  reviewImageDownload(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.storage.createProductImageReviewDownload(this.ctx(req), id); }
}

@ApiTags('public-catalog')
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}
  @Get('products')
  list(@Query('countryId', ParseUUIDPipe) countryId: string, @Query('cityId') cityId?: unknown, @Query('categoryId') categoryId?: unknown, @Query('q') q?: unknown, @Query('limit') limit?: unknown, @Query('cursor') cursor?: unknown) {
    const rawLimit = optionalPublicString(limit, 'LIMIT_INVALID', 'limit must be 1-50');
    const parsedLimit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) throw new BadRequestException({ code: 'LIMIT_INVALID', message: 'limit must be 1-50' });
    const city = optionalPublicUuid(cityId, 'CITY_ID_INVALID', 'cityId');
    const category = optionalPublicUuid(categoryId, 'CATEGORY_ID_INVALID', 'categoryId');
    const pageCursor = optionalPublicUuid(cursor, 'CURSOR_INVALID', 'cursor');
    const search = optionalPublicSearch(q, 120);
    return this.catalog.publicList({ countryId: countryId.toLowerCase(), ...(city ? { cityId: city } : {}), ...(category ? { categoryId: category } : {}), ...(search ? { q: search } : {}), limit: parsedLimit, ...(pageCursor ? { cursor: pageCursor } : {}) });
  }
  @Get('categories')
  categories(@Query('countryId', ParseUUIDPipe) countryId: string) { return this.catalog.publicCategories(countryId); }
  @Get('products/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @Query('countryId', ParseUUIDPipe) countryId: string) { return this.catalog.publicDetail(id, countryId); }
  @Get('products/:id/images/:imageId')
  async image(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string, @Query('countryId', ParseUUIDPipe) countryId: string, @Res() res: Response) {
    const { data, contentType } = await this.catalog.publicProductImage(id, imageId, countryId);
    res.setHeader('Content-Type', contentType); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(data);
  }
}
