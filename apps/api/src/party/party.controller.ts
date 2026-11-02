import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { PartyService } from './party.service.js';
import type { AccessContext, RiderVehicleType, VendorMembershipRole } from '@getstoopy/core';

class CreateVendorDto {
  @IsUUID() countryId!: string;
  @IsString() @MinLength(2) @MaxLength(120) displayName!: string;
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
}
class CreateRiderDto {
  @IsUUID() countryId!: string;
  @IsIn(['BICYCLE', 'MOTORBIKE', 'CAR', 'OTHER']) vehicleType!: RiderVehicleType;
}
class ActivateDto {
  @IsInt() @Min(1) version!: number;
  @IsUUID() kycCaseId!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class SuspendDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class GrantMembershipDto {
  @IsUUID() userId!: string;
  @IsIn(['MANAGER', 'STAFF']) role!: VendorMembershipRole;
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

@ApiTags('party')
@Controller('parties')
export class PartyController {
  constructor(@Inject(PartyService) private readonly party: PartyService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('vendors') @UseGuards(SessionGuard, CsrfGuard)
  createVendor(@Req() req: Request, @Body() body: CreateVendorDto) { return this.party.createVendor(this.ctx(req), body); }
  @Get('vendors/me') @UseGuards(SessionGuard)
  myVendor(@Req() req: Request) { return this.party.myVendor(this.ctx(req)); }
  @Post('riders') @UseGuards(SessionGuard, CsrfGuard)
  createRider(@Req() req: Request, @Body() body: CreateRiderDto) { return this.party.createRider(this.ctx(req), body); }
  @Get('riders/me') @UseGuards(SessionGuard)
  myRider(@Req() req: Request) { return this.party.myRider(this.ctx(req)); }

  @Post('admin/vendors/:id/activate') @UseGuards(SessionGuard, CsrfGuard)
  activateVendor(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ActivateDto) { return this.party.activateVendor(this.ctx(req), id, body); }
  @Post('admin/vendors/:id/suspend') @UseGuards(SessionGuard, CsrfGuard)
  suspendVendor(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SuspendDto) { return this.party.suspendVendor(this.ctx(req), id, body); }
  @Post('admin/riders/:id/activate') @UseGuards(SessionGuard, CsrfGuard)
  activateRider(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ActivateDto) { return this.party.activateRider(this.ctx(req), id, body); }
  @Post('admin/riders/:id/suspend') @UseGuards(SessionGuard, CsrfGuard)
  suspendRider(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SuspendDto) { return this.party.suspendRider(this.ctx(req), id, body); }

  @Get('vendors/:id/memberships') @UseGuards(SessionGuard)
  memberships(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.party.listMemberships(this.ctx(req), id); }
  @Post('vendors/:id/memberships') @UseGuards(SessionGuard, CsrfGuard)
  grant(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: GrantMembershipDto) { return this.party.grantMembership(this.ctx(req), id, body); }
  @Post('vendors/:id/memberships/:membershipId/revoke') @UseGuards(SessionGuard, CsrfGuard)
  revoke(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Param('membershipId', ParseUUIDPipe) membershipId: string) { return this.party.revokeMembership(this.ctx(req), id, membershipId); }
}
