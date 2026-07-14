import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { requestContextMiddleware } from './request-context.middleware';
import { runtimeConfig } from './runtime-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(requestContextMiddleware);
  app.enableShutdownHooks();
  await app.listen(runtimeConfig.port, '0.0.0.0');
}

void bootstrap();
