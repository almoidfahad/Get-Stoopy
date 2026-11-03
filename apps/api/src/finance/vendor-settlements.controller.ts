import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { VendorSettlementsService } from './vendor-settlements.service.js';
import type { AccessContext } from '@getstoopy/core';
class PolicyDto { @IsUUID() vendorId!: string; @IsInt() @Min(0) @Max(9999) commissionBps!: number; @IsInt() @Min(0) @Max(90) holdDays!: number; @IsISO8601() effectiveFrom!: string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class PrepareDto { @IsUUID() vendorId!: string; @IsUUID() destinationId!: string; @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) suborderIds!: string[]; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class ReviewDto { @IsInt() @Min(1) expectedVersion!: number; @IsIn(['APPROVE','REJECT']) decision!: 'APPROVE'|'REJECT'; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; @IsString() @MinLength(8) @MaxLength(512) reason!: string; }
@ApiTags('finance') @Controller() @UseGuards(SessionGuard)
export class VendorSettlementsController {
 constructor(@Inject(VendorSettlementsService) private readonly settlements: VendorSettlementsService) {}
 private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
 @Post('admin/vendor-commission-policies') @UseGuards(CsrfGuard) policy(@Req() req: Request,@Body() body: PolicyDto) { return this.settlements.createPolicy(this.ctx(req),body); }
 @Post('admin/vendor-settlements') @UseGuards(CsrfGuard) prepare(@Req() req: Request,@Body() body: PrepareDto) { return this.settlements.prepare(this.ctx(req),body); }
 @Get('admin/vendor-settlements') list(@Req() req: Request,@Query('countryId',ParseUUIDPipe) countryId: string) { return this.settlements.list(this.ctx(req),countryId); }
 @Get('vendors/:vendorId/settlements') mine(@Req() req: Request,@Param('vendorId',ParseUUIDPipe) id: string) { return this.settlements.listMine(this.ctx(req),id); }
 @Get('vendor-settlements/:id') get(@Req() req: Request,@Param('id',ParseUUIDPipe) id: string) { return this.settlements.get(this.ctx(req),id); }
 @Post('admin/vendor-settlements/:id/review') @UseGuards(CsrfGuard) review(@Req() req: Request,@Param('id',ParseUUIDPipe) id: string,@Body() body: ReviewDto) { return this.settlements.review(this.ctx(req),id,body); }
}
