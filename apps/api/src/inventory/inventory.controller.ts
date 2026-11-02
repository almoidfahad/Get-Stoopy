import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { InventoryService } from './inventory.service.js';
import type { AccessContext } from '@getstoopy/core';

class InitializeInventoryDto {
  @IsOptional() @IsInt() @Min(0) @Max(1000000) reorderLevel?: number;
}
class AdjustInventoryDto {
  @IsInt() @Min(1) version!: number;
  @IsInt() @Min(-1000000) @Max(1000000) delta!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(SessionGuard)
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('variants/:variantId/initialize') @UseGuards(CsrfGuard)
  initialize(@Req() req: Request, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() body: InitializeInventoryDto) { return this.inventory.initialize(this.ctx(req), variantId, body); }
  @Get('variants/:variantId')
  get(@Req() req: Request, @Param('variantId', ParseUUIDPipe) variantId: string) { return this.inventory.get(this.ctx(req), variantId); }
  @Post('variants/:variantId/adjustments') @UseGuards(CsrfGuard)
  adjust(@Req() req: Request, @Param('variantId', ParseUUIDPipe) variantId: string, @Body() body: AdjustInventoryDto) { return this.inventory.adjust(this.ctx(req), variantId, body); }
  @Get('variants/:variantId/movements')
  movements(@Req() req: Request, @Param('variantId', ParseUUIDPipe) variantId: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new BadRequestException({ code: 'LIMIT_INVALID', message: 'limit must be 1-100' });
    if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) throw new BadRequestException({ code: 'CURSOR_INVALID', message: 'Invalid cursor' });
    return this.inventory.movements(this.ctx(req), variantId, parsedLimit, cursor);
  }
}
