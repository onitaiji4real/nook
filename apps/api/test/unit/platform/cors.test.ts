import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApiCors } from '../../../src/platform/http/cors';

@Controller('cors-contract')
class CorsContractController {
  @Get()
  read(): { readonly ok: true } {
    return { ok: true };
  }

  @Post()
  write(): { readonly ok: true } {
    return { ok: true };
  }
}

describe('API CORS contract', () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CorsContractController],
    }).compile();
    app = module.createNestApplication();
    configureApiCors(app, ['http://localhost:3000', 'https://app.nook.example']);
    await app.init();
    httpServer = app.getHttpServer() as unknown as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows an exact configured origin and explicit request headers', async () => {
    const response = await request(httpServer)
      .options('/cors-contract')
      .set('origin', 'https://app.nook.example')
      .set('access-control-request-method', 'POST')
      .set(
        'access-control-request-headers',
        'authorization,content-type,idempotency-key,x-request-id',
      )
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('https://app.nook.example');
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,DELETE,OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe(
      'Authorization,Content-Type,Idempotency-Key,X-Request-Id',
    );
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers.vary).toContain('Origin');
  });

  it('does not grant CORS headers to an unconfigured origin', async () => {
    const response = await request(httpServer)
      .options('/cors-contract')
      .set('origin', 'https://attacker.example')
      .set('access-control-request-method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('keeps non-browser and same-origin requests usable without an Origin header', async () => {
    const response = await request(httpServer).get('/cors-contract').expect(200);
    expect(response.body as unknown).toEqual({ ok: true });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
