import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  completePortfolioUploadRequestSchema,
  createPortfolioUploadIntentRequestSchema,
  mediaAssetIdSchema,
  portfolioItemIdSchema,
  reorderPortfolioItemsRequestSchema,
  tenantIdSchema,
  updatePortfolioItemRequestSchema,
  type CreatePortfolioUploadIntentRequest,
  type PortfolioResponse,
  type PortfolioUploadCompleteResponse,
  type PortfolioUploadIntentResponse,
  type ReorderPortfolioItemsRequest,
  type UpdatePortfolioItemRequest,
} from '@nook/contracts';

import { ApplicationError } from '../../application-error';
import { AuthenticationGuard } from '../../authentication.guard';
import { ProblemDetailsFilter } from '../../problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from '../../request-context';
import { PortfolioApplicationService } from './portfolio-application.service';

interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

@Controller('v1/tenants/:tenantId/portfolio')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class PortfolioController {
  constructor(
    @Inject(PortfolioApplicationService) private readonly service: PortfolioApplicationService,
  ) {}

  @Get()
  list(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
  ): Promise<PortfolioResponse> {
    return this.service.list(this.context(request, tenantId));
  }

  @Post('upload-intents')
  createUploadIntent(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<PortfolioUploadIntentResponse> {
    return this.service.createUploadIntent({
      ...this.context(request, tenantId),
      body: this.parse<CreatePortfolioUploadIntentRequest>(
        createPortfolioUploadIntentRequestSchema,
        body,
      ),
    });
  }

  @Post('media/:mediaAssetId/complete')
  completeUpload(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('mediaAssetId') mediaAssetId: string,
    @Body() body: unknown,
  ): Promise<PortfolioUploadCompleteResponse> {
    this.parse(completePortfolioUploadRequestSchema, body);
    return this.service.completeUpload({
      ...this.context(request, tenantId),
      mediaAssetId: this.id(mediaAssetIdSchema, mediaAssetId, 'invalid_media_asset_id'),
    });
  }

  @Put('order')
  reorder(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<PortfolioResponse> {
    return this.service.reorder({
      ...this.context(request, tenantId),
      body: this.parse<ReorderPortfolioItemsRequest>(reorderPortfolioItemsRequestSchema, body),
    });
  }

  @Patch(':portfolioItemId')
  update(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('portfolioItemId') portfolioItemId: string,
    @Body() body: unknown,
  ): Promise<PortfolioResponse> {
    return this.service.update({
      ...this.context(request, tenantId),
      portfolioItemId: this.id(portfolioItemIdSchema, portfolioItemId, 'invalid_portfolio_item_id'),
      body: this.parse<UpdatePortfolioItemRequest>(updatePortfolioItemRequestSchema, body),
    });
  }

  @Delete(':portfolioItemId')
  remove(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('portfolioItemId') portfolioItemId: string,
  ): Promise<PortfolioResponse> {
    return this.service.remove({
      ...this.context(request, tenantId),
      portfolioItemId: this.id(portfolioItemIdSchema, portfolioItemId, 'invalid_portfolio_item_id'),
    });
  }

  private context(request: RequestWithContext, rawTenantId: string) {
    return {
      tenantId: this.id(tenantIdSchema, rawTenantId, 'invalid_tenant_id'),
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    };
  }

  private id(schema: SafeParser<string>, value: string, code: string): string {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ApplicationError(400, code, 'Bad Request', 'The resource ID is invalid.');
    return parsed.data;
  }

  private parse<T>(schema: SafeParser<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApplicationError(
        400,
        'invalid_request',
        'Bad Request',
        'The request body is invalid.',
      );
    return parsed.data;
  }
}
