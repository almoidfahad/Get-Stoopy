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
    const first = await request(app).get('/api/v1/commerce/carts/PrivatePathValue?address=PrivateQueryValue').set('x-request-id', 'PrivateRequestIdValue').expect(200);
    const second = await request(app).get('/api/v1/commerce/PrivateUnknownValue?address=PrivateQueryValue').set('x-request-id', 'PrivateRequestIdValue').expect(404);
    const firstId = first.headers['x-request-id']; const secondId = second.headers['x-request-id'];
    expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(firstId).not.toBe(secondId);
    const lines = log.mock.calls.map(args => JSON.parse(String(args[0])));
    expect(lines.find(line => line.requestId === firstId)).toMatchObject({ message: 'http_request', path: '/api/v1/commerce/carts/:cartId', method: 'GET', status: 200 });
    expect(lines.find(line => line.requestId === secondId)).toMatchObject({ message: 'http_request', path: '[unmatched]', method: 'GET', status: 404 });
    for (const secret of ['PrivatePathValue', 'PrivateQueryValue', 'PrivateUnknownValue', 'PrivateRequestIdValue']) expect(JSON.stringify(lines)).not.toContain(secret);
  });
});
