import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  merchantSlugSchema,
  availabilityQuerySchema,
  merchantVisibilityRequestSchema,
  portfolioItemIdSchema,
  portfolioPublicationRequestSchema,
  tenantIdSchema,
  type MerchantPublicationResponse,
  type MerchantVisibilityRequest,
  type PortfolioPublicationRequest,
  type PublicMerchantResponse,
  type PublicAvailabilityResponse,
} from '@nook/contracts';

import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';
import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { MerchantPublicationApplicationService } from './merchant-publication-application.service';
import { AvailabilityApplicationService } from './availability-application.service';

interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

@Controller('v1/tenants/:tenantId/publication')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class MerchantPublicationController {
  constructor(
    @Inject(MerchantPublicationApplicationService)
    private readonly service: MerchantPublicationApplicationService,
  ) {}

  @Get()
  get(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
  ): Promise<MerchantPublicationResponse> {
    return this.service.get(this.context(request, tenantId));
  }

  @Put()
  changeVisibility(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<MerchantPublicationResponse> {
    return this.service.changeVisibility({
      ...this.context(request, tenantId),
      body: this.parse<MerchantVisibilityRequest>(merchantVisibilityRequestSchema, body),
    });
  }

  @Put('portfolio/:portfolioItemId')
  changePortfolioStatus(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('portfolioItemId') portfolioItemId: string,
    @Body() body: unknown,
  ): Promise<MerchantPublicationResponse> {
    return this.service.changePortfolioStatus({
      ...this.context(request, tenantId),
      portfolioItemId: this.parse(portfolioItemIdSchema, portfolioItemId),
      body: this.parse<PortfolioPublicationRequest>(portfolioPublicationRequestSchema, body),
    });
  }

  private context(request: RequestWithContext, tenantId: string) {
    return {
      tenantId: this.parse(tenantIdSchema, tenantId),
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    };
  }

  private parse<T>(schema: SafeParser<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
    return parsed.data;
  }
}

@Controller('v1/marketplace/merchants')
@UseFilters(ProblemDetailsFilter)
export class MarketplaceController {
  constructor(
    @Inject(MerchantPublicationApplicationService)
    private readonly service: MerchantPublicationApplicationService,
    @Inject(AvailabilityApplicationService)
    private readonly availability: AvailabilityApplicationService,
  ) {}

  @Get(':slug/availability')
  findAvailability(
    @Req() request: RequestWithContext,
    @Param('slug') rawSlug: string,
    @Query() rawQuery: unknown,
  ): Promise<PublicAvailabilityResponse> {
    const slug = merchantSlugSchema.safeParse(rawSlug);
    const query = availabilityQuerySchema.safeParse(rawQuery);
    if (!slug.success)
      throw new ApplicationError(
        404,
        'availability_not_found',
        'Not Found',
        'Availability was not found.',
      );
    if (!query.success)
      throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
    return this.availability.find({
      slug: slug.data,
      query: query.data,
      requestId: requireRequestId(request),
    });
  }

  @Get(':slug')
  find(@Param('slug') rawSlug: string): Promise<PublicMerchantResponse> {
    const parsed = merchantSlugSchema.safeParse(rawSlug);
    if (!parsed.success)
      throw new ApplicationError(
        404,
        'merchant_not_found',
        'Not Found',
        'The merchant is not published.',
      );
    return this.service.findPublic(parsed.data);
  }
}
