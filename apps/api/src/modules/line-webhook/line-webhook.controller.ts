import { Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';

import { LineWebhookApplicationService } from './line-webhook-application.service';
import { requireRequestId, type RequestWithContext } from '../../platform/http/request-context';

@Controller('v1/webhooks/line')
export class LineWebhookController {
  constructor(
    @Inject(LineWebhookApplicationService)
    private readonly service: LineWebhookApplicationService,
  ) {}

  @Post('messaging')
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<RequestWithContext>,
    @Headers('x-line-signature') signature: string | undefined,
  ): Promise<{
    readonly accepted: true;
    readonly processedCount: number;
    readonly replayedCount: number;
  }> {
    return this.service.receive({
      rawBody: request.rawBody,
      signature,
      requestId: requireRequestId(request),
    });
  }
}
