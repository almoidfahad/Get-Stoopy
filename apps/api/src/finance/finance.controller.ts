import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { FinanceService } from './finance.service.js';
import type { AccessContext } from '@getstoopy/core';

class SlabDto { @IsInt() @Min(0) lowerMeters!: number; @IsOptional() @IsInt() @Min(1) upperMeters?: number | null; @IsString() @Matches(/^[1-9][0-9]*$/) amountMinor!: string; }
class RateRuleDto { @IsString() countryId!: string; @IsString() @Matches(/^[A-Z]{3}$/) currency!: string; @IsISO8601() effectiveFrom!: string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; @IsArray() @ValidateNested({ each: true }) @Type(() => SlabDto) slabs!: SlabDto[]; }
class DepositDto { @IsString() @Matches(/^[1-9][0-9]*$/) amountMinor!: string; @IsString() @Matches(/^[A-Z]{3}$/) currency!: string; @IsIn(['COMPANY_OFFICE','BANK','MERCHANT_MFS']) method!: 'COMPANY_OFFICE'|'BANK'|'MERCHANT_MFS'; @IsString() @MinLength(3) @MaxLength(128) externalReference!: string; @IsString() @Matches(/^[0-9a-f]{64}$/i) evidenceHash!: string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class ReviewDepositDto { @IsInt() @Min(1) expectedVersion!: number; @IsIn(['VERIFY','REJECT']) decision!: 'VERIFY'|'REJECT'; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; @IsString() @MinLength(8) @MaxLength(512) reason!: string; }

@ApiTags('finance')
@Controller()
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Post('admin/rider-rate-rules') @UseGuards(CsrfGuard)
  rate(@Req() req: Request, @Body() body: RateRuleDto) { return this.finance.createRateRule(this.ctx(req), { ...body, slabs: body.slabs.map(s => ({ lowerMeters: s.lowerMeters, upperMeters: s.upperMeters ?? null, amountMinor: s.amountMinor })) }); }
  @Post('riders/me/cod-deposits') @UseGuards(CsrfGuard)
  deposit(@Req() req: Request, @Body() body: DepositDto) { return this.finance.submitDeposit(this.ctx(req), body); }
  @Get('riders/me/wallet')
  wallet(@Req() req: Request) { return this.finance.wallet(this.ctx(req)); }
  @Get('admin/cod-deposits')
  list(@Req() req: Request) { const id = String((req.query as any).countryId ?? ''); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException({ code: 'COUNTRY_ID_INVALID', message: 'countryId query parameter is required' }); return this.finance.listDeposits(this.ctx(req), id); }
  @Post('admin/cod-deposits/:depositId/review') @UseGuards(CsrfGuard)
  review(@Req() req: Request, @Param('depositId', ParseUUIDPipe) id: string, @Body() body: ReviewDepositDto) { return this.finance.reviewDeposit(this.ctx(req), id, body); }
}
