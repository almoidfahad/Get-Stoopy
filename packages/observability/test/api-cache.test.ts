import { describe, expect, it } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { apiNoStore } from '../../../apps/api/src/common/api-cache';

function testApp() {
  const app = express();
  // Mirror the versioned API mount and the middleware ordering in main.ts.
  app.use('/api/v1', apiNoStore);
  app.options('/api/v1/orders/:id', (_req, res) => res.sendStatus(204));
  app.use(express.json());
  app.get('/api/v1/auth/me', (_req, res) => res.json({ csrfToken: 'example' }));
  app.get('/api/v1/orders/:id', (_req, res) => res.status(401).json({ code: 'UNAUTHORIZED' }));
  app.post('/api/v1/orders/:id', (_req, res) => res.status(403).json({ code: 'CSRF' }));
  app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/failure', () => { throw new Error('synthetic failure'); });
  app.get('/api/docs', (_req, res) => res.sendStatus(200));
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => res.sendStatus(err.status ?? 500));
  return app;
}

describe('versioned API no-store default', () => {
  it('sets no-store for private and public responses, preflight, not-found and early parsing errors', async () => {
    const app = testApp();
    const responses = [
      await request(app).get('/api/v1/auth/me').expect(200),
      await request(app).get('/api/v1/health/live').expect(200),
      await request(app).get('/api/v1/orders/example').expect(401),
      await request(app).post('/api/v1/orders/example').send({}).expect(403),
      await request(app).get('/api/v1/not-a-route').expect(404),
      await request(app).get('/api/v1/failure').expect(500),
      await request(app).post('/api/v1/orders/example').set('Content-Type', 'application/json').send('{"malformed":').expect(400),
      await request(app).options('/api/v1/orders/example').expect(204)
    ];
    for (const response of responses) expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not claim to cover docs or a different prefix', async () => {
    const app = testApp();
    const docs = await request(app).get('/api/docs').expect(200);
    const other = await request(app).get('/api/v10/orders').expect(404);
    expect(docs.headers['cache-control']).toBeUndefined();
    expect(other.headers['cache-control']).toBeUndefined();
  });
});
