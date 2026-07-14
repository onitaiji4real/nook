import { Controller, Get, Header, Res } from '@nestjs/common';
import type { HealthResponse } from '@nook/contracts';
import type { Response } from 'express';

import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @Header('Cache-Control', 'no-store')
  health(): HealthResponse {
    return this.healthService.health();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async readiness(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const result = await this.healthService.readiness();
    response.status(result.statusCode);
    return result.body;
  }
}
