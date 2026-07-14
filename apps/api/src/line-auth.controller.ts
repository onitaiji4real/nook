import { Body, Controller, HttpCode, Inject, Post, Req, UseFilters } from '@nestjs/common';
import {
  lineExchangeRequestSchema,
  type LineExchangeRequest,
  type LineExchangeResponse,
} from '@nook/contracts';

import { ApplicationError } from './application-error';
import { LineAuthApplicationService } from './line-auth-application.service';
import { ProblemDetailsFilter } from './problem-details.filter';
import { requireRequestId, type RequestWithContext } from './request-context';

@Controller('v1/auth/line')
@UseFilters(ProblemDetailsFilter)
export class LineAuthController {
  constructor(
    @Inject(LineAuthApplicationService) private readonly service: LineAuthApplicationService,
  ) {}

  @Post('exchange')
  @HttpCode(200)
  exchange(
    @Body() body: unknown,
    @Req() request: RequestWithContext,
  ): Promise<LineExchangeResponse> {
    const parsed = lineExchangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApplicationError(
        400,
        'invalid_request',
        'Bad Request',
        'The request body is invalid.',
      );
    }
    const input: LineExchangeRequest = parsed.data;
    return this.service.exchange(input.idToken, input.nonce, requireRequestId(request));
  }
}
