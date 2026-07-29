import { Controller, Headers, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';

import { requireRequestId, type RequestWithContext } from '../../request-context';
import {
  NotificationDispatchRequestError,
  NotificationDispatchService,
  type NotificationDispatchResult,
} from './notification-dispatch.service';

@Controller('internal/notifications')
export class NotificationDispatchController {
  constructor(
    @Inject(NotificationDispatchService) private readonly service: NotificationDispatchService,
  ) {}

  @Post('dispatch')
  @HttpCode(200)
  async dispatch(
    @Req() request: RequestWithContext,
    @Headers('x-cloudscheduler') scheduler: string | undefined,
  ): Promise<NotificationDispatchResult> {
    try {
      this.service.requireScheduler(scheduler);
      return await this.service.run(requireRequestId(request));
    } catch (error) {
      if (error instanceof NotificationDispatchRequestError) {
        throw new HttpException({ status: error.status, code: error.code }, error.status);
      }
      throw error;
    }
  }
}
