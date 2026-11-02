import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { CommerceService } from './commerce.service.js';
import type { AccessContext } from '@getstoopy/core';

class CreateCartDto {
  @IsUUID() countryId!: string;
}
class AddCartItemDto {
  @IsUUID() variantId!: string;
  @IsInt() @Min(1) @Max(100) quantity!: number;
  @IsInt() @Min(1) expectedVersion!: number;
}
class UpdateCartItemDto {
  @IsInt() @Min(1) @Max(100) quantity!: number;
  @IsInt() @Min(1) expectedVersion!: number;
}
class CreateQuoteDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsUUID() destinationCityId!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsOptional() @IsInt() @Min(60) @Max(900) ttlSeconds?: number;
}
class ReleaseQuoteDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}

@ApiTags('commerce')
@Controller('commerce')
@UseGuards(SessionGuard)
export class CommerceController {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('carts') @UseGuards(CsrfGuard)
  createCart(@Req() req: Request, @Body() body: CreateCartDto) { return this.commerce.createCart(this.ctx(req), body.countryId); }
  @Get('carts/:cartId')
  getCart(@Req() req: Request, @Param('cartId', ParseUUIDPipe) cartId: string) { return this.commerce.getCart(this.ctx(req), cartId); }
  @Post('carts/:cartId/items') @UseGuards(CsrfGuard)
  addItem(@Req() req: Request, @Param('cartId', ParseUUIDPipe) cartId: string, @Body() body: AddCartItemDto) { return this.commerce.addItem(this.ctx(req), cartId, body); }
  @Patch('carts/:cartId/items/:variantId') @UseGuards(CsrfGuard)
  updateItem(@Req() req: Request, @Param('cartId', ParseUUIDPipe) cartId: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() body: UpdateCartItemDto) { return this.commerce.updateItem(this.ctx(req), cartId, variantId, body); }
  @Delete('carts/:cartId/items/:variantId') @UseGuards(CsrfGuard)
  removeItem(@Req() req: Request, @Param('cartId', ParseUUIDPipe) cartId: string, @Param('variantId', ParseUUIDPipe) variantId: string, @Query('expectedVersion') expectedVersion?: string) {
    const version = Number(expectedVersion);
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException({ code: 'VERSION_INVALID', message: 'expectedVersion query parameter is required' });
    return this.commerce.removeItem(this.ctx(req), cartId, variantId, version);
  }
  @Post('carts/:cartId/quotes') @UseGuards(CsrfGuard)
  createQuote(@Req() req: Request, @Param('cartId', ParseUUIDPipe) cartId: string, @Body() body: CreateQuoteDto) { return this.commerce.createQuote(this.ctx(req), cartId, body); }
  @Get('quotes/:quoteId')
  getQuote(@Req() req: Request, @Param('quoteId', ParseUUIDPipe) quoteId: string) { return this.commerce.getQuote(this.ctx(req), quoteId); }
  @Post('quotes/:quoteId/release') @UseGuards(CsrfGuard)
  releaseQuote(@Req() req: Request, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body() body: ReleaseQuoteDto) { return this.commerce.releaseQuote(this.ctx(req), quoteId, body); }
}
