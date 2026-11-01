import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, HttpCode, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { SecurityService } from './security.service.js';
import type { AccessContext } from '@getstoopy/core';
class StepUpDto { @IsOptional() @IsString() @MaxLength(12) code?: string; @IsOptional() @IsString() @MaxLength(64) recoveryCode?: string; }
class ConfirmDto { @IsString() @MaxLength(12) code!: string; }
class RevokeUserDto { @IsString() @MaxLength(512) @MinLength(8) reason!: string; }
class LinkDto { @IsString() @MaxLength(8192) idToken!: string; }
@ApiTags('security')
@Controller('auth')
@UseGuards(SessionGuard, CsrfGuard)
export class SecurityController {
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Get('mfa') status(@Req() req: Request) { return this.security.status(this.ctx(req)); }
  @Post('mfa/enroll') enroll(@Req() req: Request) { return this.security.beginEnrollment(this.ctx(req)); }
  @Post('mfa/confirm') confirm(@Req() req: Request, @Body() body: ConfirmDto) { return this.security.confirmEnrollment(this.ctx(req), body.code); }
  @Post('mfa/step-up') stepUp(@Req() req: Request, @Body() body: StepUpDto) { return this.security.stepUp(this.ctx(req), body); }
  @Post('mfa/recovery-codes') recovery(@Req() req: Request) { return this.security.regenerateRecoveryCodes(this.ctx(req)); }
  @Get('sessions') sessions(@Req() req: Request) { return this.security.listSessions(this.ctx(req)); }
  @Delete('sessions/:id') @HttpCode(204) async revoke(@Req() req: Request, @Param('id') id: string) { await this.security.revokeSession(this.ctx(req), id); }
  @Post('sessions/revoke-others') revokeOthers(@Req() req: Request) { return this.security.revokeOtherSessions(this.ctx(req)); }
  @Post('emergency/revoke-user/:id') emergency(@Req() req: Request, @Param('id') id: string, @Body() body: RevokeUserDto) { return this.security.emergencyRevokeUser(this.ctx(req), id, body.reason); }
  @Post('identities/link') link(@Req() req: Request, @Body() body: LinkDto) { return this.security.linkIdentity(this.ctx(req), body.idToken); }
}
