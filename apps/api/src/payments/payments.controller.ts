import { BadRequestException } from '@nestjs/common';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MaxLength, MinLength, IsIn } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
import { CancellationsService } from './cancellations.service.js';
import type { AccessContext } from '@getstoopy/core';

class CreateOrderDto {
  @IsUUID() quoteId!: string;
  @IsInt() @Min(1) expectedQuoteVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsString() @Matches(/^(SANDBOX_MANUAL|COD)$/) paymentMethod!: 'SANDBOX_MANUAL' | 'COD';
}
class CreateIntentDto {
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}
class CodPolicyDto {
  @IsUUID() countryId!: string;
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(0|[1-9][0-9]*)$/) maxOrderMinor!: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}

class CancelOrderDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
}
class ReviewRefundDto extends CancelOrderDto {
  @IsIn(['APPROVE','REJECT']) decision!: 'APPROVE' | 'REJECT';
}

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService, @Inject(PaymentsService) private readonly payments: PaymentsService, @Inject(CancellationsService) private readonly cancellations: CancellationsService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Get('payments/capabilities')
  capabilities() { return this.payments.capabilities(); }

  @Post('orders') @UseGuards(SessionGuard, CsrfGuard)
  createOrder(@Req() req: Request, @Body() body: CreateOrderDto) { return this.orders.createFromQuote(this.ctx(req), body); }
  @Get('orders/:orderId') @UseGuards(SessionGuard)
  getOrder(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string) { return this.orders.get(this.ctx(req), orderId); }

  @Post('orders/:orderId/cancellation') @UseGuards(SessionGuard, CsrfGuard)
  cancel(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: CancelOrderDto) { return this.cancellations.cancel(this.ctx(req), orderId, body); }
  @Get('refunds/:refundId') @UseGuards(SessionGuard)
  ownRefund(@Req() req: Request, @Param('refundId', ParseUUIDPipe) id: string) { return this.cancellations.getOwnRefund(this.ctx(req), id); }
  @Get('admin/refunds') @UseGuards(SessionGuard)
  listRefunds(@Req() req: Request) { const id = String((req.query as any).countryId ?? ''); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException({ code: 'COUNTRY_ID_INVALID', message: 'A countryId query parameter is required' }); return this.cancellations.list(this.ctx(req), id); }
  @Post('admin/refunds/:refundId/review') @UseGuards(SessionGuard, CsrfGuard)
  reviewRefund(@Req() req: Request, @Param('refundId', ParseUUIDPipe) id: string, @Body() body: ReviewRefundDto) { return this.cancellations.review(this.ctx(req), id, body); }

  @Post('orders/:orderId/payment-intents') @UseGuards(SessionGuard, CsrfGuard)
  createIntent(@Req() req: Request, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: CreateIntentDto) { return this.payments.createIntent(this.ctx(req), orderId, body); }
  @Get('payment-intents/:intentId') @UseGuards(SessionGuard)
  getIntent(@Req() req: Request, @Param('intentId', ParseUUIDPipe) intentId: string) { return this.payments.getIntent(this.ctx(req), intentId); }

  /** Public provider callback: authenticated by HMAC, not by browser session/CSRF. */
  @Post('payments/webhooks/sandbox') @HttpCode(200)
  sandboxWebhook(@Req() req: Request) {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    return this.payments.sandboxWebhook(req.header('x-gs-timestamp'), req.header('x-gs-signature'), rawBody);
  }

  @Put('admin/cod-policy') @UseGuards(SessionGuard, CsrfGuard)
  upsertCodPolicy(@Req() req: Request, @Body() body: CodPolicyDto) { return this.payments.upsertCodPolicy(this.ctx(req), body); }
}
