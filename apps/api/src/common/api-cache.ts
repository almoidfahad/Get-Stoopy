import type { NextFunction, Request, Response } from 'express';

/**
 * Default versioned API responses to no-store, including early errors.
 * Register before CORS and body parsing. Explicitly reviewed public caching
 * must be introduced separately; a middleware header can be overwritten by
 * later handlers or infrastructure and is not a substitute for proxy policy.
 */
export function apiNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
