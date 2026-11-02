import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { ServiceabilityService } from './serviceability.service.js';
import type { AccessContext, OperatingHourInput } from '@getstoopy/core';

class ProposePickupDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
class ReviewPickupDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class OperatingHoursDto {
  @IsArray() @ArrayMaxSize(21) hours!: OperatingHourInput[];
}
class ProposeServiceAreaDto {
  @IsUUID() serviceZoneId!: string;
}
class ReviewServiceAreaDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(['APPROVE', 'REJECT', 'SUSPEND']) decision!: 'APPROVE' | 'REJECT' | 'SUSPEND';
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}

@ApiTags('serviceability')
@Controller('catalog')
@UseGuards(SessionGuard)
export class ServiceabilityController {
  constructor(@Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('stores/:storeId/pickup-point') @UseGuards(CsrfGuard)
  proposePickup(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: ProposePickupDto) { return this.serviceability.proposePickup(this.ctx(req), storeId, body); }
  @Get('stores/:storeId/serviceability')
  get(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string) { return this.serviceability.get(this.ctx(req), storeId); }
  @Put('stores/:storeId/operating-hours') @UseGuards(CsrfGuard)
  hours(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: OperatingHoursDto) { return this.serviceability.replaceOperatingHours(this.ctx(req), storeId, body.hours); }
  @Post('stores/:storeId/service-areas') @UseGuards(CsrfGuard)
  proposeArea(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: ProposeServiceAreaDto) { return this.serviceability.proposeServiceArea(this.ctx(req), storeId, body.serviceZoneId); }
  @Post('admin/stores/:storeId/pickup-point/review') @UseGuards(CsrfGuard)
  reviewPickup(@Req() req: Request, @Param('storeId', ParseUUIDPipe) storeId: string, @Body() body: ReviewPickupDto) { return this.serviceability.reviewPickup(this.ctx(req), storeId, body); }
  @Post('admin/service-areas/:serviceAreaId/review') @UseGuards(CsrfGuard)
  reviewArea(@Req() req: Request, @Param('serviceAreaId', ParseUUIDPipe) serviceAreaId: string, @Body() body: ReviewServiceAreaDto) { return this.serviceability.reviewServiceArea(this.ctx(req), serviceAreaId, body); }
}
