import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApiCors } from './cors';
import { requestContextMiddleware } from './request-context.middleware';
import { runtimeConfig } from './runtime-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    rawBody: true,
  });

  app.useBodyParser('json', { limit: '256kb' });
  configureApiCors(app, runtimeConfig.apiCorsAllowedOrigins);
  app.use(requestContextMiddleware);
  app.enableShutdownHooks();
  await app.listen(runtimeConfig.port, '0.0.0.0');
}

void bootstrap();
