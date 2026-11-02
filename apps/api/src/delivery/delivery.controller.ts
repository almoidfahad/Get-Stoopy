import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { DeliveryService } from './delivery.service.js';
import type { AccessContext } from '@getstoopy/core';

class RecipientDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(8) @MaxLength(20) phone!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class CommandDto { @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class VerifyOtpDto {
  @IsString() @Matches(/^[0-9]{6}$/) code!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class CompleteDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}

@ApiTags('delivery')
@Controller()
@UseGuards(SessionGuard)
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Post('orders/:orderId/delivery-recipient') @UseGuards(CsrfGuard)
  recipient(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: RecipientDto) { return this.delivery.setRecipient(this.ctx(req), orderId, body); }
  @Post('riders/me/assignments/:assignmentId/pickup') @UseGuards(CsrfGuard)
  pickup(@Req() req: Request, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() body: CommandDto) { return this.delivery.confirmPickup(this.ctx(req), assignmentId, body); }
  @Get('riders/me/deliveries/:deliveryId')
  get(@Req() req: Request, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) { return this.delivery.get(this.ctx(req), deliveryId); }
  @Post('riders/me/deliveries/:deliveryId/otp-challenges') @UseGuards(CsrfGuard)
  issueOtp(@Req() req: Request, @Param('deliveryId', ParseUUIDPipe) deliveryId: string, @Body() body: CommandDto) { return this.delivery.issueOtp(this.ctx(req), deliveryId, body); }
  @Post('riders/me/deliveries/:deliveryId/otp-challenges/:challengeId/verify') @UseGuards(CsrfGuard)
  verifyOtp(@Req() req: Request, @Param('deliveryId', ParseUUIDPipe) deliveryId: string, @Param('challengeId', ParseUUIDPipe) challengeId: string, @Body() body: VerifyOtpDto) { return this.delivery.verifyOtp(this.ctx(req), deliveryId, challengeId, body); }
  @Post('riders/me/deliveries/:deliveryId/complete') @UseGuards(CsrfGuard)
  complete(@Req() req: Request, @Param('deliveryId', ParseUUIDPipe) deliveryId: string, @Body() body: CompleteDto) { return this.delivery.complete(this.ctx(req), deliveryId, body); }
}
