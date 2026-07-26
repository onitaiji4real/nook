import type { INestApplication } from '@nestjs/common';

export function configureApiCors(app: INestApplication, allowedOrigins: readonly string[]): void {
  app.enableCors({
    origin: [...allowedOrigins],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
}
