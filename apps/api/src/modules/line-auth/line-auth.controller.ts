import { Body, Controller, HttpCode, Inject, Post, Req, UseFilters } from '@nestjs/common';
import {
  lineExchangeRequestSchema,
  type LineExchangeRequest,
  type LineExchangeResponse,
} from '@nook/contracts';

import { LineAuthApplicationService } from './line-auth-application.service';
import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import { requireRequestId, type RequestWithContext } from '../../platform/http/request-context';

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
