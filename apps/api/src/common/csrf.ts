import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { csrfTokenForSession } from '@getstoopy/bff';
import { Request } from 'express';
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return true;
    const origin = req.header('origin');
    const allowed = process.env['WEB_ORIGIN'];
    if (!origin || origin !== allowed) throw new ForbiddenException({ code: 'ORIGIN_DENIED', message: 'Origin is not allowed' });
    const sessionToken = (req as any).sessionToken as string | undefined;
    const header = req.header('x-csrf-token');
    if (!sessionToken || !header || header !== csrfTokenForSession(sessionToken)) throw new ForbiddenException({ code: 'CSRF_DENIED', message: 'CSRF token is invalid' });
    return true;
  }
}
