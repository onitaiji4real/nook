import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  marketingConsentIdempotencyKeySchema,
  marketingConsentTenantIdSchema,
  type MarketingConsentResponse,
} from '@nook/contracts';

import { ApplicationError } from '../../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../../platform/http/request-context';
import { AuthenticationGuard } from '../../../platform/identity/authentication.guard';
import { MarketingConsentApplicationService } from './marketing-consent-application.service';

@Controller('v1/me/marketing-consents')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class MarketingConsentController {
  constructor(
    @Inject(MarketingConsentApplicationService)
    private readonly service: MarketingConsentApplicationService,
  ) {}

  @Get(':tenantId')
  readCurrent(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
  ): Promise<MarketingConsentResponse> {
    return this.service.readCurrent({
      tenantId: parseTenantId(rawTenantId),
      consumerUserId: requirePrincipal(request).userId,
    });
  }

  @Post(':tenantId')
  @HttpCode(200)
  grant(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
    @Body() body: unknown,
  ): Promise<MarketingConsentResponse> {
    return this.service.grant({
      tenantId: parseTenantId(rawTenantId),
      consumerUserId: requirePrincipal(request).userId,
      idempotencyKey: parseIdempotencyKey(rawIdempotencyKey),
      requestId: requireRequestId(request),
      body,
    });
  }

  @Delete(':tenantId')
  @HttpCode(200)
  withdraw(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
    @Query('expectedRevision') expectedRevision: unknown,
  ): Promise<MarketingConsentResponse> {
    return this.service.withdraw({
      tenantId: parseTenantId(rawTenantId),
      consumerUserId: requirePrincipal(request).userId,
      idempotencyKey: parseIdempotencyKey(rawIdempotencyKey),
      requestId: requireRequestId(request),
      expectedRevision,
    });
  }
}

function parseTenantId(value: string): string {
  const parsed = marketingConsentTenantIdSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data.toLowerCase();
}

function parseIdempotencyKey(value: unknown): string {
  const parsed = marketingConsentIdempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data.toLowerCase();
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}
