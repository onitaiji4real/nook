import { Controller, Headers, HttpException, Inject, Post, Req } from '@nestjs/common';

import { requireRequestId, type RequestWithContext } from '../../request-context';
import {
  BookingHoldExpiryRequestError,
  BookingHoldExpiryService,
} from './booking-hold-expiry.service';

@Controller('internal/booking-holds')
export class BookingHoldExpiryController {
  constructor(
    @Inject(BookingHoldExpiryService) private readonly service: BookingHoldExpiryService,
  ) {}

  @Post('expire')
  async expire(
    @Req() request: RequestWithContext,
    @Headers('x-cloudscheduler') scheduler: string | undefined,
  ): Promise<{ readonly expiredCount: number }> {
    try {
      this.service.requireScheduler(scheduler);
      return await this.service.run(requireRequestId(request));
    } catch (error) {
      if (error instanceof BookingHoldExpiryRequestError) {
        throw new HttpException({ status: error.status, code: error.code }, error.status);
      }
      throw error;
    }
  }
}
