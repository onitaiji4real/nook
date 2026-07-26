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
} from '@nook/contracts';

import { ApplicationError } from './application-error';
import { AuthenticationGuard } from './authentication.guard';
import { LineStudioEntryApplicationService } from './line-studio-entry-application.service';
import { ProblemDetailsFilter } from './problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from './request-context';

@Controller('v1/line')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class LineStudioEntryController {
  constructor(
    @Inject(LineStudioEntryApplicationService)
    private readonly service: LineStudioEntryApplicationService,
  ) {}

  @Post('studio-entry-events')
  @HttpCode(204)
  async record(@Req() request: RequestWithContext, @Body() rawBody: unknown): Promise<void> {
    const event = this.parseEvent(rawBody);
    await this.service.record({
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
