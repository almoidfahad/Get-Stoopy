import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { parse } from 'cookie';
import { SessionService } from './session.service.js';
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const cookies = parse(req.headers.cookie ?? '');
    const name = process.env['SESSION_COOKIE_NAME'] ?? 'gs_session_dev';
    const token = cookies[name];
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Session cookie is missing' });
    const resolved = await this.sessions.resolve(token);
    (req as any).accessContext = resolved.context;
    (req as any).sessionToken = resolved.sessionToken;
    return true;
  }
}
