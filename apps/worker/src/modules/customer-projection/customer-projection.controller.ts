import { Controller, Headers, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';

import { requireRequestId, type RequestWithContext } from '../../request-context';
import {
  CustomerProjectionRequestError,
  CustomerProjectionService,
  type CustomerProjectionRunResult,
} from './customer-projection.service';

@Controller('internal/customer-projection')
export class CustomerProjectionController {
  constructor(
    @Inject(CustomerProjectionService) private readonly service: CustomerProjectionService,
  ) {}

  @Post('run')
  @HttpCode(200)
  async run(
    @Req() request: RequestWithContext,
    @Headers('x-cloudscheduler') scheduler: string | undefined,
  ): Promise<CustomerProjectionRunResult> {
    try {
      this.service.requireScheduler(scheduler);
      return await this.service.run(requireRequestId(request));
    } catch (error) {
      if (error instanceof CustomerProjectionRequestError) {
        throw new HttpException({ status: error.status, code: error.code }, error.status);
      }
      throw error;
    }
  }
}
