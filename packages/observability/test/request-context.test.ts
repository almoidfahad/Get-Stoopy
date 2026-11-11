import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request } from 'express';
import { RequestContextMiddleware, requestRouteTemplate } from '../../../apps/api/src/common/request-context';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTTP request logging', () => {
  it('fails closed when no plain, bounded server route template is available', () => {
    const fake = (route: unknown) => ({ route } as Request);
    expect(requestRouteTemplate(fake(undefined))).toBe('[unmatched]');
    expect(requestRouteTemplate(fake({ path: /private/ }))).toBe('[unmatched]');
    expect(requestRouteTemplate(fake({ path: ['/a', '/b'] }))).toBe('[unmatched]');
    expect(requestRouteTemplate(fake({ path: `/${'x'.repeat(257)}` }))).toBe('[unmatched]');
    expect(requestRouteTemplate(fake({ path: '/invalid\nline' }))).toBe('[unmatched]');
    expect(requestRouteTemplate(fake({ path: '/api/v1/commerce/carts/:cartId' }))).toBe('/api/v1/commerce/carts/:cartId');
  });

  it('uses registered templates and never logs a caller path segment or query', async () => {
    const app = express(); const middleware = new RequestContextMiddleware();
    app.use(middleware.use.bind(middleware));
    app.get('/api/v1/commerce/carts/:cartId', (_req, res) => res.sendStatus(200));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await request(app).get('/api/v1/commerce/carts/PrivatePathValue?address=PrivateQueryValue').set('x-request-id', 'testing-log-one').expect(200);
    await request(app).get('/api/v1/commerce/PrivateUnknownValue?address=PrivateQueryValue').set('x-request-id', 'testing-log-two').expect(404);
    const lines = log.mock.calls.map(args => JSON.parse(String(args[0])));
    expect(lines.find(line => line.requestId === 'testing-log-one')).toMatchObject({ message: 'http_request', path: '/api/v1/commerce/carts/:cartId', method: 'GET', status: 200 });
    expect(lines.find(line => line.requestId === 'testing-log-two')).toMatchObject({ message: 'http_request', path: '[unmatched]', method: 'GET', status: 404 });
    for (const secret of ['PrivatePathValue', 'PrivateQueryValue', 'PrivateUnknownValue']) expect(JSON.stringify(lines)).not.toContain(secret);
  });
});
