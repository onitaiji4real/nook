import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from '@nestjs/common';

import { requireRequestId, type RequestWithContext } from '../../request-context';
import {
  NotificationDeliveryRequestError,
  NotificationDeliveryService,
  type NotificationDeliveryResult,
} from './notification-delivery.service';

@Controller('internal/notifications')
export class NotificationDeliveryController {
  constructor(
    @Inject(NotificationDeliveryService) private readonly service: NotificationDeliveryService,
  ) {}

  @Post('deliver')
  @HttpCode(200)
  async deliver(
    @Req() request: RequestWithContext,
    @Body() body: unknown,
    @Headers('x-cloudtasks-queuename') queueName: string | undefined,
  ): Promise<NotificationDeliveryResult> {
    try {
      this.service.requireTask(queueName);
      const input = this.service.parseBody(body);
      return await this.service.deliver(input.jobId, requireRequestId(request));
    } catch (error) {
      if (error instanceof NotificationDeliveryRequestError) {
        throw new HttpException({ status: error.status, code: error.code }, error.status);
      }
      throw error;
    }
  }
}
