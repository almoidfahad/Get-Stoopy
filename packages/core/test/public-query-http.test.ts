import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { PublicCatalogController } from '../../../apps/api/src/catalog/catalog.controller.js';
import { CatalogService } from '../../../apps/api/src/catalog/catalog.service.js';
import { PublicServiceabilityController } from '../../../apps/api/src/serviceability/public-serviceability.controller.js';
import { ServiceabilityService } from '../../../apps/api/src/serviceability/serviceability.service.js';
import { StableExceptionFilter } from '../../../apps/api/src/common/errors.js';

const country = 'aabbccdd-1111-4111-8111-111111111111';
const city = 'aabbccdd-2222-4222-8222-222222222222';
const category = 'aabbccdd-3333-4333-8333-333333333333';
const cursor = 'aabbccdd-4444-4444-8444-444444444444';
const catalog = { publicList: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) };
const serviceability = { publicServiceableCities: vi.fn().mockResolvedValue({ items: [], truncated: false }) };
class TestModule {}
Module({ controllers: [PublicCatalogController, PublicServiceabilityController], providers: [
  { provide: CatalogService, useValue: catalog }, { provide: ServiceabilityService, useValue: serviceability },
] })(TestModule);
let app: INestApplication;
beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new StableExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Also exercise nested inputs if an Express deployment uses the extended parser.
  app.getHttpAdapter().getInstance().set('query parser', 'extended');
  await app.init();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { catalog.publicList.mockClear(); serviceability.publicServiceableCities.mockClear(); });

describe('public catalog query validation over HTTP', () => {
  const route = `/api/v1/public/catalog/products?countryId=${country}`;
  it('normalises uppercase UUID filters and trims normal searches', async () => {
    await request(app.getHttpServer()).get(`/api/v1/public/catalog/products?countryId=${country.toUpperCase()}&cityId=${city.toUpperCase()}&categoryId=${category.toUpperCase()}&cursor=${cursor.toUpperCase()}&q=%20chair%20&limit=5`).expect(200);
    expect(catalog.publicList).toHaveBeenCalledWith({ countryId: country, cityId: city, categoryId: category, cursor, q: 'chair', limit: 5 });
  });
  it('uses defaults for absent or whitespace-only search', async () => {
    await request(app.getHttpServer()).get(route + '&q=%20%20').expect(200);
    expect(catalog.publicList).toHaveBeenCalledWith({ countryId: country, limit: 20 });
  });
  it.each([
    ['q=a&q=b', 'QUERY_INVALID'], ['q[x]=abc', 'QUERY_INVALID'], ['q=abc%00def', 'QUERY_INVALID'],
    ['q=' + 'x'.repeat(121), 'QUERY_INVALID'],
    [`cityId=${city}&cityId=${city}`, 'CITY_ID_INVALID'], [`cityId[x]=${city}`, 'CITY_ID_INVALID'],
    [`categoryId=${category}&categoryId=${category}`, 'CATEGORY_ID_INVALID'],
    [`cursor=${cursor}&cursor=${cursor}`, 'CURSOR_INVALID'], ['limit=1&limit=2', 'LIMIT_INVALID'],
    ['limit[x]=1', 'LIMIT_INVALID'], ['limit=0', 'LIMIT_INVALID'], ['limit=51', 'LIMIT_INVALID'],
  ])('rejects malformed query %s before reaching the service', async (query, code) => {
    const res = await request(app.getHttpServer()).get(`${route}&${query}`).expect(400);
    expect(res.body.code).toBe(code);
    expect(catalog.publicList).not.toHaveBeenCalled();
  });
  it('rejects repeated country IDs through the UUID pipe', async () => {
    await request(app.getHttpServer()).get(`${route}&countryId=${country}`).expect(400);
    expect(catalog.publicList).not.toHaveBeenCalled();
  });
});

describe('public serviceable cities query validation over HTTP', () => {
  const route = `/api/v1/public/serviceability/cities?countryId=${country}`;
  it('trims a valid search and normalises the country ID', async () => {
    await request(app.getHttpServer()).get(`/api/v1/public/serviceability/cities?countryId=${country.toUpperCase()}&q=%20Dhaka%20`).expect(200);
    expect(serviceability.publicServiceableCities).toHaveBeenCalledWith(country, 'Dhaka');
  });
  it.each(['q=a&q=b', 'q[x]=a', 'q=Dhaka%00', 'q=' + 'x'.repeat(61)])('rejects %s before reaching the service', async query => {
    const res = await request(app.getHttpServer()).get(`${route}&${query}`).expect(400);
    expect(res.body.code).toBe('QUERY_INVALID');
    expect(serviceability.publicServiceableCities).not.toHaveBeenCalled();
  });
  it('allows an empty search', async () => {
    await request(app.getHttpServer()).get(route + '&q=%20').expect(200);
    expect(serviceability.publicServiceableCities).toHaveBeenCalledWith(country, undefined);
  });
});
