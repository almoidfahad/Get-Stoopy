import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { DispatchService } from './dispatch.service.js';
import type { AccessContext } from '@getstoopy/core';

class DestinationDto {
  @IsUUID() serviceZoneId!: string;
  @IsUUID() boundaryVersionId!: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsString() @MinLength(5) @MaxLength(500) addressLine!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class CreateRunDto { @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class NextOfferDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class AcceptOfferDto {
  @IsString() @Matches(/^[0-9a-f]{64}$/) offerToken!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class RejectOfferDto extends AcceptOfferDto { @IsString() @MinLength(8) @MaxLength(512) reason!: string; }

@ApiTags('dispatch')
@Controller()
@UseGuards(SessionGuard)
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatch: DispatchService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Post('orders/:orderId/delivery-destination') @UseGuards(CsrfGuard)
  destination(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: DestinationDto) { return this.dispatch.setDestination(this.ctx(req), orderId, body); }
  @Post('admin/dispatch/suborders/:suborderId/runs') @UseGuards(CsrfGuard)
  createRun(@Req() req: Request, @Param('suborderId', ParseUUIDPipe) suborderId: string, @Body() body: CreateRunDto) { return this.dispatch.createRun(this.ctx(req), suborderId, body); }
  @Post('admin/dispatch/runs/:runId/next-offer') @UseGuards(CsrfGuard)
  nextOffer(@Req() req: Request, @Param('runId', ParseUUIDPipe) runId: string, @Body() body: NextOfferDto) { return this.dispatch.nextOffer(this.ctx(req), runId, body); }
  @Get('admin/dispatch/runs/:runId')
  getRun(@Req() req: Request, @Param('runId', ParseUUIDPipe) runId: string) { return this.dispatch.getRun(this.ctx(req), runId); }
  @Get('admin/dispatch/runs/:runId/history')
  history(@Req() req: Request, @Param('runId', ParseUUIDPipe) runId: string) { return this.dispatch.history(this.ctx(req), runId); }
  @Get('admin/dispatch/manual-queue')
  manualQueue(@Req() req: Request, @Query('countryId', ParseUUIDPipe) countryId: string) { return this.dispatch.manualQueue(this.ctx(req), countryId); }
  @Get('riders/me/dispatch-offers')
  myOffers(@Req() req: Request) { return this.dispatch.listMyOffers(this.ctx(req)); }
  @Get('riders/me/assignment')
  myAssignment(@Req() req: Request) { return this.dispatch.myAssignment(this.ctx(req)); }
  @Post('riders/me/dispatch-offers/:offerId/accept') @UseGuards(CsrfGuard)
  accept(@Req() req: Request, @Param('offerId', ParseUUIDPipe) offerId: string, @Body() body: AcceptOfferDto) { return this.dispatch.acceptOffer(this.ctx(req), offerId, body); }
  @Post('riders/me/dispatch-offers/:offerId/reject') @UseGuards(CsrfGuard)
  reject(@Req() req: Request, @Param('offerId', ParseUUIDPipe) offerId: string, @Body() body: RejectOfferDto) { return this.dispatch.rejectOffer(this.ctx(req), offerId, body); }
}
