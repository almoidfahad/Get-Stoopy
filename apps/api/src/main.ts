import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { RequestContextMiddleware } from './common/request-context.js';
import { apiNoStore } from './common/api-cache.js';
import { loadApiEnv } from '@getstoopy/config';

const API_PREFIX = 'api/v1';

export async function createApp() {
  const env = loadApiEnv(process.env);
  const app = await NestFactory.create(AppModule, { logger: ['error','warn','log'], rawBody: true });
  // Register before CORS and the parser (which Nest installs during init) so
  // early failures and preflights get the same independent request ID.
  const requestContext = new RequestContextMiddleware();
  app.use(requestContext.use.bind(requestContext));
  // Versioned API routes include private auth, payment, delivery and commerce
  // data. Apply a conservative default before CORS, parsing and guards, even
  // for public endpoints; review any future public caching explicitly.
  app.use(`/${API_PREFIX}`, apiNoStore);
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const config = new DocumentBuilder().setTitle('Get Stoopy API').setVersion('0.2.0').addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  return app;
}
const isMain = process.argv[1] && /main\.(js|ts)$/.test(process.argv[1]);
if (isMain) {
  const env = loadApiEnv(process.env);
  createApp().then(app => app.listen(env.PORT, '0.0.0.0')).then(() => new Logger('Bootstrap').log(`API listening on ${env.PORT}`));
}
