import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
@Catch()
export class StableExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as any).requestId ?? 'unknown';
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      code = typeof r === 'object' && r.code ? r.code : codeForStatus(status);
      message = typeof r === 'object' && r.message ? (Array.isArray(r.message) ? r.message.join('; ') : r.message) : exception.message;
    } else if (exception instanceof Error && ['ACCOUNT_LINKING_REQUIRED','OIDC_VERIFICATION_FAILED'].includes(exception.message)) {
      status = HttpStatus.CONFLICT; code = exception.message; message = 'Account linking requires an approved verification flow';
    }
    if (status >= 500) { this.logger.error(`${code} requestId=${requestId}`); if (process.env['NODE_ENV'] !== 'production' && exception instanceof Error) this.logger.error(exception.stack ?? exception.message); }
    res.status(status).json({ code, message, requestId });
  }
}
function codeForStatus(status: number): string {
  return ({400:'BAD_REQUEST',401:'UNAUTHENTICATED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',422:'DOMAIN_VALIDATION',429:'RATE_LIMITED'} as Record<number,string>)[status] ?? 'ERROR';
}
