import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, Min, IsOptional, IsString, Matches } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { FinanceOperationsService } from './finance-operations.service.js';
import type { AccessContext } from '@getstoopy/core';
class KeyDto { @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string; }
class AdjustmentDto extends KeyDto { @IsString() @Matches(/^-?(0|[1-9][0-9]*)$/) amountMinor!: string; @IsString() reason!: string; @IsString() @Matches(/^[0-9a-f]{64}$/i) evidenceHash!: string; }
class ReviewDto extends KeyDto { @IsString() reason!: string; @IsIn(['APPROVE','REJECT']) decision!: 'APPROVE'|'REJECT'; @IsInt() @Min(1) expectedVersion!: number; }
class SubmitDto extends KeyDto { @IsOptional() @IsBoolean() simulateUnknown?: boolean; }
class ReconcileDto extends KeyDto { @IsIn(['SUCCEEDED','FAILED']) status!: 'SUCCEEDED'|'FAILED'; @IsString() statementReference!: string; @IsString() @Matches(/^[0-9a-f]{64}$/i) evidenceHash!: string; }
@Controller() @UseGuards(SessionGuard)
export class FinanceOperationsController {
 constructor(@Inject(FinanceOperationsService) private readonly ops:FinanceOperationsService){}
 private ctx(req:Request){return (req as any).accessContext as AccessContext;}
 @Post('admin/vendor-settlements/:id/adjustments') @UseGuards(CsrfGuard) adjustment(@Req() req:Request,@Param('id',ParseUUIDPipe) settlementId:string,@Body() body:AdjustmentDto){return this.ops.createAdjustment(this.ctx(req),{...body,settlementId});}
 @Post('admin/finance-adjustments/:id/review') @UseGuards(CsrfGuard) review(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:ReviewDto){return this.ops.reviewAdjustment(this.ctx(req),id,body);}
 @Post('admin/vendor-settlements/:id/payout-reservations') @UseGuards(CsrfGuard) reserve(@Req() req:Request,@Param('id',ParseUUIDPipe) settlementId:string,@Body() body:KeyDto){return this.ops.reservePayout(this.ctx(req),{...body,settlementId});}
 @Post('admin/sandbox-transfers/:kind/:id/submit') @UseGuards(CsrfGuard) submit(@Req() req:Request,@Param('kind') kind:string,@Param('id',ParseUUIDPipe) id:string,@Body() body:SubmitDto){if(kind!=='refunds'&&kind!=='payouts')throw new Error('KIND_INVALID');return this.ops.submit(this.ctx(req),{...body,kind:kind==='refunds'?'REFUND':'PAYOUT',id});}
 @Post('admin/sandbox-transfers/:kind/:id/reconcile') @UseGuards(CsrfGuard) reconcile(@Req() req:Request,@Param('kind') kind:string,@Param('id',ParseUUIDPipe) id:string,@Body() body:ReconcileDto){if(kind!=='refunds'&&kind!=='payouts')throw new Error('KIND_INVALID');return this.ops.reconcile(this.ctx(req),{...body,kind:kind==='refunds'?'REFUND':'PAYOUT',id});}
 @Get('sandbox-transfers/:kind/:id') get(@Req() req:Request,@Param('kind') kind:string,@Param('id',ParseUUIDPipe) id:string){if(kind!=='refunds'&&kind!=='payouts')throw new Error('KIND_INVALID');return this.ops.getTransfer(this.ctx(req),kind==='refunds'?'REFUND':'PAYOUT',id);}
}
