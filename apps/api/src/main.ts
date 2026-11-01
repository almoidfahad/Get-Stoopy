import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadApiEnv } from '@getstoopy/config';
export async function createApp() {
  const env = loadApiEnv(process.env);
  const app = await NestFactory.create(AppModule, { logger: ['error','warn','log'] });
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
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
