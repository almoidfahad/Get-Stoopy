import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { KycService } from './kyc.service.js';
import type { AccessContext, KycCaseStatus, KycDecision, KycSubjectType } from '@getstoopy/core';

class CreateCaseDto {
  @IsIn(['VENDOR', 'RIDER']) subjectType!: KycSubjectType;
  @IsUUID() countryId!: string;
  @IsString() @MinLength(1) @MaxLength(64) policyVersion!: string;
  @IsString() @MinLength(1) @MaxLength(64) consentVersion!: string;
  @IsBoolean() @Equals(true) consent!: boolean;
}
class LinkDocumentDto {
  @IsUUID() storageObjectId!: string;
  @IsString() @MinLength(3) @MaxLength(64) documentType!: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
}
class SubmitDto { @IsInt() @Min(1) version!: number; }
class DecisionDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(8) @MaxLength(128) commandKey!: string;
  @IsIn(['START_REVIEW', 'APPROVE', 'REJECT', 'REQUEST_MORE_INFORMATION', 'REVOKE']) decision!: KycDecision;
  @IsString() @MinLength(8) @MaxLength(512) reason!: string;
  @IsOptional() @IsIn(['MANUAL_DOCUMENT_REVIEW']) verificationMethod?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  @Post('cases') @UseGuards(SessionGuard, CsrfGuard)
  create(@Req() req: Request, @Body() body: CreateCaseDto) { return this.kyc.createCase(this.ctx(req), body); }

  @Get('eligibility') @UseGuards(SessionGuard)
  eligibility(@Req() req: Request, @Query('subjectType') subjectType: KycSubjectType, @Query('countryId', ParseUUIDPipe) countryId: string) { return this.kyc.eligibility(this.ctx(req), subjectType, countryId); }

  @Get('admin/cases') @UseGuards(SessionGuard)
  queue(@Req() req: Request, @Query('countryId', ParseUUIDPipe) countryId: string, @Query('status') status?: KycCaseStatus, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new BadRequestException({ code: 'LIMIT_INVALID', message: 'limit must be 1-100' });
    const statuses: KycCaseStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION', 'APPROVED', 'REJECTED', 'REVOKED'];
    if (status !== undefined && !statuses.includes(status)) throw new BadRequestException({ code: 'KYC_STATUS_INVALID', message: 'Invalid KYC status filter' });
    if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) throw new BadRequestException({ code: 'CURSOR_INVALID', message: 'Invalid cursor' });
    return this.kyc.reviewQueue(this.ctx(req), countryId, status, parsedLimit, cursor);
  }

  @Post('admin/cases/:id/decision') @UseGuards(SessionGuard, CsrfGuard)
  decide(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecisionDto) { return this.kyc.decide(this.ctx(req), id, body); }

  @Get('cases/:id') @UseGuards(SessionGuard)
  ownCase(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.kyc.getOwnCase(this.ctx(req), id); }

  @Post('cases/:id/documents') @UseGuards(SessionGuard, CsrfGuard)
  link(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: LinkDocumentDto) { return this.kyc.linkDocument(this.ctx(req), id, body); }

  @Post('cases/:id/submit') @UseGuards(SessionGuard, CsrfGuard)
  submit(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitDto) { return this.kyc.submitCase(this.ctx(req), id, body.version); }

  @Post('cases/:id/documents/:documentId/access') @UseGuards(SessionGuard, CsrfGuard)
  access(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) { return this.kyc.documentAccess(this.ctx(req), id, documentId); }
}
