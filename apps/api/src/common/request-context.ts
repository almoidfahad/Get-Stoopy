import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { logRecord } from '@getstoopy/observability';
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    res.on('finish', () => {
      const line = logRecord('info', 'http_request', { requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start });
      console.log(JSON.stringify(line));
    });
    next();
  }
}
