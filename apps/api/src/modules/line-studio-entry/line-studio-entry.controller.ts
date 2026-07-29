import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  merchantStudioEntryEventRequestSchema,
  type MerchantStudioEntryEventRequest,
  type StudioNavigationDecision,
} from '@nook/contracts';

import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { LineStudioEntryApplicationService } from './line-studio-entry-application.service';
import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';

@Controller('v1/line')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class LineStudioEntryController {
  constructor(
    @Inject(LineStudioEntryApplicationService)
    private readonly service: LineStudioEntryApplicationService,
  ) {}

  @Post('studio-entry-events')
  @HttpCode(200)
  async record(
    @Req() request: RequestWithContext,
    @Body() rawBody: unknown,
  ): Promise<StudioNavigationDecision> {
    const event = this.parseEvent(rawBody);
    return this.service.record({
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      event,
    });
  }

  private parseEvent(rawBody: unknown): MerchantStudioEntryEventRequest {
    const parsed = merchantStudioEntryEventRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApplicationError(
        400,
        'invalid_line_studio_entry_event',
        'Bad Request',
        'The LINE Studio entry event is invalid.',
      );
    }
    return parsed.data;
  }
}
