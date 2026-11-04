import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { RiskCasesService } from './risk-cases.service.js';
import type { AccessContext } from '@getstoopy/core';

class ReviewRiskCaseDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['CLEAR', 'CONFIRM_FRAUD']) decision!: 'CLEAR' | 'CONFIRM_FRAUD';
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}

@Controller('risk/cases') @UseGuards(SessionGuard)
export class RiskCasesController {
  constructor(@Inject(RiskCasesService) private readonly service: RiskCasesService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Get() list(@Req() req: Request, @Query('countryId', ParseUUIDPipe) countryId: string) { return this.service.list(this.ctx(req), countryId); }
  @Get(':id') detail(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(this.ctx(req), id); }
  @Post(':id/review') @UseGuards(CsrfGuard) review(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewRiskCaseDto) { return this.service.review(this.ctx(req), id, body); }
}
