import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  merchantOnboardingRequestSchema,
  tenantIdSchema,
  type MerchantOnboardingRequest,
  type MerchantOnboardingResponse,
} from '@nook/contracts';

import { ApplicationError } from './application-error';
import { AuthenticationGuard } from './authentication.guard';
import { MerchantOnboardingApplicationService } from './merchant-onboarding-application.service';
import { ProblemDetailsFilter } from './problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from './request-context';

@Controller('v1/tenants/:tenantId/merchant-onboarding')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class MerchantOnboardingController {
  constructor(
    @Inject(MerchantOnboardingApplicationService)
    private readonly service: MerchantOnboardingApplicationService,
  ) {}

  @Put()
  async save(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Body() rawBody: unknown,
  ): Promise<MerchantOnboardingResponse> {
    return this.service.save({
      tenantId: this.parseTenantId(rawTenantId),
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      body: this.parseBody(rawBody),
    });
  }

  @Get()
  async get(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
  ): Promise<MerchantOnboardingResponse> {
    return this.service.get({
      tenantId: this.parseTenantId(rawTenantId),
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    });
  }

  private parseTenantId(rawTenantId: string): string {
    const result = tenantIdSchema.safeParse(rawTenantId);
    if (!result.success) {
      throw new ApplicationError(
        400,
        'invalid_tenant_id',
        'Bad Request',
        'The tenant ID is invalid.',
      );
    }
    return result.data;
  }

  private parseBody(rawBody: unknown): MerchantOnboardingRequest {
    const result = merchantOnboardingRequestSchema.safeParse(rawBody);
    if (!result.success) {
      throw new ApplicationError(
        400,
        'invalid_request',
        'Bad Request',
        'The request body is invalid.',
      );
    }
    return result.data;
  }
}
