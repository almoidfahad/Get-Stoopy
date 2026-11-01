import { Body, Controller, Get, Post, Req, UseGuards, Headers, UnauthorizedException, HttpCode, Inject } from '@nestjs/common';
import { constantTimeEqual } from '@getstoopy/auth';
import { csrfTokenForSession } from '@getstoopy/bff';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
class CreateSessionDto {
  @ApiProperty() @IsString() @MaxLength(8192) idToken!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(8192) accessToken?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(8192) refreshToken?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(64) providerExpiresAt?: string;
}
import { ApiTags } from '@nestjs/swagger';
import { SessionService } from './session.service.js';
import { SessionGuard } from './session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { Request } from 'express';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}
  @Post('session')
  @HttpCode(201)
  async create(@Headers('x-bff-secret') secret: string, @Body() body: CreateSessionDto) {
    const expected = process.env['BFF_API_SHARED_SECRET'] ?? '';
    if (!secret || !expected || !constantTimeEqual(secret, expected)) throw new UnauthorizedException({ code: 'BFF_AUTH_REQUIRED', message: 'BFF authentication required' });
    if (!body?.idToken || typeof body.idToken !== 'string') throw new UnauthorizedException({ code: 'ID_TOKEN_REQUIRED', message: 'idToken is required' });
    return this.sessions.createFromIdToken({
      idToken: body.idToken,
      ...(body.accessToken ? { accessToken: body.accessToken } : {}),
      ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
      ...(body.providerExpiresAt ? { providerExpiresAt: body.providerExpiresAt } : {})
    });
  }
  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: Request) {
    const ctx = (req as any).accessContext;
    return { user: { id: ctx.userId, assurance: ctx.assurance }, permissions: ctx.permissions, scopes: ctx.scopes, csrfToken: csrfTokenForSession((req as any).sessionToken) };
  }
  @Post('logout')
  @UseGuards(SessionGuard, CsrfGuard)
  @HttpCode(204)
  async logout(@Req() req: Request) { await this.sessions.revoke((req as any).sessionToken); }
}
