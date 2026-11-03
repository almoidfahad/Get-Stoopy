import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { KycRetentionService } from './kyc-retention.service.js';
import type { AccessContext, KycSubjectType } from '@getstoopy/core';
class PolicyDto { @IsUUID() countryId!:string; @IsIn(['VENDOR','RIDER','ADMIN']) subjectType!:KycSubjectType; @IsInt() @Min(0) @Max(3650) approvedRetentionDays!:number; @IsInt() @Min(0) @Max(3650) rejectedRetentionDays!:number; @IsInt() @Min(0) @Max(3650) revokedRetentionDays!:number; @IsInt() @Min(1) @Max(90) reminderDays!:number; @IsString() @MinLength(8) @MaxLength(512) legalBasis!:string; @IsString() @MinLength(1) @MaxLength(64) policyVersion!:string; }
class HoldDto { @IsString() @MinLength(8) @MaxLength(512) reason!:string; @IsString() @Matches(/^[0-9a-f]{64}$/i) evidenceHash!:string; }
class ReleaseDto { @IsString() @MinLength(8) @MaxLength(512) reason!:string; }
class DeletionDto { @IsString() @MinLength(8) @MaxLength(512) reason!:string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!:string; }
class ReviewDto extends DeletionDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['APPROVE','REJECT']) decision!:'APPROVE'|'REJECT'; }
class TickDto { @IsUUID() countryId!:string; @IsInt() @Min(1) @Max(500) batchSize!:number; }
@Controller('kyc/admin') @UseGuards(SessionGuard,CsrfGuard)
export class KycRetentionController { constructor(@Inject(KycRetentionService) private readonly s:KycRetentionService){} private ctx(req:Request){return (req as any).accessContext as AccessContext;}
 @Post('retention-policies') policy(@Req() req:Request,@Body() body:PolicyDto){return this.s.createPolicy(this.ctx(req),body);}
 @Post('cases/:id/legal-holds') hold(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:HoldDto){return this.s.hold(this.ctx(req),id,body);}
 @Post('legal-holds/:id/release') release(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:ReleaseDto){return this.s.releaseHold(this.ctx(req),id,body);}
 @Post('cases/:id/deletion-requests') deletion(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:DeletionDto){return this.s.requestDeletion(this.ctx(req),id,body);}
 @Post('deletion-requests/:id/review') review(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:ReviewDto){return this.s.reviewDeletion(this.ctx(req),id,body);}
 @Post('retention-tick') tick(@Req() req:Request,@Body() body:TickDto){return this.s.runTick(this.ctx(req),body.countryId,body.batchSize);}
}
