import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, IsUUID, isUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { PayoutDestinationsService } from './payout-destinations.service.js';
import type { AccessContext, PayoutRail } from '@getstoopy/core';

class SubmitDestinationDto {
  @IsUUID() countryId!: string; @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['BANK', 'MERCHANT_MFS']) rail!: PayoutRail;
  @IsString() @MinLength(2) @MaxLength(200) accountHolderName!: string;
  @IsString() @MinLength(6) @MaxLength(64) accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(120) institutionName!: string;
  @IsUUID() proofStorageObjectId!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class ReviewDestinationDto {
  @IsInt() @Min(1) expectedVersion!: number; @IsIn(['VERIFY', 'REJECT']) decision!: 'VERIFY' | 'REJECT';
  @IsString() @MinLength(8) @MaxLength(128) verificationReference!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class RetireDestinationDto {
  @IsInt() @Min(1) expectedVersion!: number; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
@ApiTags('finance') @Controller() @UseGuards(SessionGuard)
export class PayoutDestinationsController {
  constructor(@Inject(PayoutDestinationsService) private readonly destinations: PayoutDestinationsService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Post('vendors/:vendorId/payout-destinations') @UseGuards(CsrfGuard)
  submit(@Req() req: Request, @Param('vendorId', ParseUUIDPipe) id: string, @Body() body: SubmitDestinationDto) { return this.destinations.submit(this.ctx(req), id, body); }
  @Get('vendors/:vendorId/payout-destinations')
  mine(@Req() req: Request, @Param('vendorId', ParseUUIDPipe) id: string) { return this.destinations.listMine(this.ctx(req), id); }
  @Post('vendors/:vendorId/payout-destinations/:destinationId/retire') @UseGuards(CsrfGuard)
  retire(@Req() req: Request, @Param('vendorId', ParseUUIDPipe) vendorId: string, @Param('destinationId', ParseUUIDPipe) id: string, @Body() body: RetireDestinationDto) { return this.destinations.retire(this.ctx(req), vendorId, id, body); }
  @Get('admin/payout-destinations')
  pending(@Req() req: Request) { const id = String((req.query as any).countryId ?? ''); if (!isUUID(id)) throw new BadRequestException({ code: 'COUNTRY_ID_INVALID', message: 'countryId query parameter is required' }); return this.destinations.listPending(this.ctx(req), id); }
  @Post('admin/payout-destinations/:destinationId/review') @UseGuards(CsrfGuard)
  review(@Req() req: Request, @Param('destinationId', ParseUUIDPipe) id: string, @Body() body: ReviewDestinationDto) { return this.destinations.review(this.ctx(req), id, body); }
}
