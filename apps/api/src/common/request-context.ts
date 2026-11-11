import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { logRecord } from '@getstoopy/observability';

/** Only a server-registered route template is safe to log, never a URL. */
export function requestRouteTemplate(req: Request): string {
  const path = req.route?.path;
  // RegExp, arrays, missing routes and unusual definitions fail closed.
  return typeof path === 'string' && path.length <= 256 && /^\/[A-Za-z0-9_/:{}*?.+-]*$/.test(path)
    ? path : '[unmatched]';
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      // req.path/originalUrl can contain names, phones, addresses or tokens,
      // even when route parameters fail validation. A route template preserves
      // operational grouping without recording any caller-supplied path/query.
      const line = logRecord('info', 'http_request', { requestId, method: req.method, path: requestRouteTemplate(req), status: res.statusCode, durationMs: Date.now() - start });
      console.log(JSON.stringify(line));
    });
    next();
  }
}
