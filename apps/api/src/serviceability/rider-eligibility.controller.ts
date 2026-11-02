import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { RiderEligibilityService } from './rider-eligibility.service.js';
import type { AccessContext } from '@getstoopy/core';

class ConsentDto {
  @IsBoolean() consented!: boolean;
  @IsString() @MinLength(1) @MaxLength(64) consentVersion!: string;
}
class StartShiftDto {
  @IsString() @MinLength(1) @MaxLength(64) consentVersion!: string;
}
class LocationSampleDto {
  @IsUUID() shiftId!: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsInt() @Min(0) @Max(1000) accuracyMeters!: number;
  @IsISO8601() recordedAt!: string;
}
class GrantZoneDto {
  @IsUUID() serviceZoneId!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

@ApiTags('rider-eligibility')
@Controller()
@UseGuards(SessionGuard)
export class RiderEligibilityController {
  constructor(@Inject(RiderEligibilityService) private readonly riders: RiderEligibilityService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('riders/me/location-consent') @UseGuards(CsrfGuard)
  consent(@Req() req: Request, @Body() body: ConsentDto) { return this.riders.setConsent(this.ctx(req), body); }
  @Post('riders/me/shifts') @UseGuards(CsrfGuard)
  startShift(@Req() req: Request, @Body() body: StartShiftDto) { return this.riders.startShift(this.ctx(req), body); }
  @Post('riders/me/shifts/:shiftId/end') @UseGuards(CsrfGuard)
  endShift(@Req() req: Request, @Param('shiftId', ParseUUIDPipe) shiftId: string) { return this.riders.endShift(this.ctx(req), shiftId); }
  @Post('riders/me/location-samples') @UseGuards(CsrfGuard)
  location(@Req() req: Request, @Body() body: LocationSampleDto) { return this.riders.recordLocation(this.ctx(req), body); }
  @Get('riders/me/eligibility')
  eligibility(@Req() req: Request, @Query('serviceZoneId', ParseUUIDPipe) serviceZoneId: string) { return this.riders.eligibility(this.ctx(req), serviceZoneId); }
  @Post('admin/riders/:riderId/zone-grants') @UseGuards(CsrfGuard)
  grantZone(@Req() req: Request, @Param('riderId', ParseUUIDPipe) riderId: string, @Body() body: GrantZoneDto) { return this.riders.grantZone(this.ctx(req), riderId, body); }
  @Post('admin/rider-zone-grants/:grantId/revoke') @UseGuards(CsrfGuard)
  revokeZone(@Req() req: Request, @Param('grantId', ParseUUIDPipe) grantId: string) { return this.riders.revokeZoneGrant(this.ctx(req), grantId); }
}
