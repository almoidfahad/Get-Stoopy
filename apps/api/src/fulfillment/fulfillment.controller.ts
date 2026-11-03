import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { FulfillmentService } from './fulfillment.service.js';
import type { AccessContext } from '@getstoopy/core';

class AcceptSuborderDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsInt() @Min(1) @Max(1440) preparationMinutes!: number;
}
class RejectSuborderDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class ReadinessCommandDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
const SUBORDER_STATUSES = ['PENDING_VENDOR', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'FULFILLING', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

@ApiTags('fulfillment')
@Controller('vendor')
@UseGuards(SessionGuard)
export class FulfillmentController {
  constructor(@Inject(FulfillmentService) private readonly fulfillment: FulfillmentService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  private pagination(limit?: string, cursor?: string) {
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new BadRequestException({ code: 'LIMIT_INVALID', message: 'limit must be 1-100' });
    if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) throw new BadRequestException({ code: 'CURSOR_INVALID', message: 'Invalid cursor' });
    return { limit: parsedLimit, ...(cursor ? { cursor } : {}) };
  }

  @Get('stores/:storeId/suborders')
  listByStore(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    if (status !== undefined && !SUBORDER_STATUSES.includes(status)) throw new BadRequestException({ code: 'SUBORDER_STATUS_INVALID', message: 'Invalid suborder status' });
    return this.fulfillment.listByStore(this.ctx(req), storeId, { ...(status ? { status } : {}), ...this.pagination(limit, cursor) });
  }
  @Get('suborders/:suborderId')
  get(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string) { return this.fulfillment.get(this.ctx(req), suborderId); }
  @Get('suborders/:suborderId/history')
  history(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.fulfillment.history(this.ctx(req), suborderId, this.pagination(limit, cursor).limit, this.pagination(limit, cursor).cursor);
  }
  @Post('suborders/:suborderId/accept') @UseGuards(CsrfGuard)
  accept(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Body() body: AcceptSuborderDto) { return this.fulfillment.accept(this.ctx(req), suborderId, body); }
  @Post('suborders/:suborderId/reject') @UseGuards(CsrfGuard)
  reject(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Body() body: RejectSuborderDto) { return this.fulfillment.reject(this.ctx(req), suborderId, body); }
  @Post('suborders/:suborderId/start-preparation') @UseGuards(CsrfGuard)
  startPreparation(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Body() body: ReadinessCommandDto) { return this.fulfillment.startPreparation(this.ctx(req), suborderId, body); }
  @Post('suborders/:suborderId/ready') @UseGuards(CsrfGuard)
  ready(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Body() body: ReadinessCommandDto) { return this.fulfillment.ready(this.ctx(req), suborderId, body); }
}
