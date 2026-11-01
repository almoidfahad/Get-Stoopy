import { Controller, Get, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../auth/session.guard.js';
import { authorize, type AccessContext } from '@getstoopy/core';
import { Request } from 'express';
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  @Get('example')
  @UseGuards(SessionGuard)
  example(@Req() req: Request, @Query('countryId') countryId: string) {
    const ctx = (req as any).accessContext as AccessContext;
    if (!countryId) throw new ForbiddenException({ code: 'COUNTRY_REQUIRED', message: 'countryId is required' });
    const decision = authorize(ctx, 'admin:example:read', { countryId }, { requireMfa: true });
    if (!decision.allow) throw new ForbiddenException({ code: decision.reason, message: 'Administrative scope denied' });
    return { ok: true, countryId, scopeEnforced: 'backend' };
  }
}
