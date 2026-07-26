import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  createTenantRequestSchema,
  tenantIdSchema,
  type CreateTenantRequest,
  type MeResponse,
  type TenantResponse,
} from '@nook/contracts';

import { ApplicationError } from './application-error';
import { AuthenticationGuard } from './authentication.guard';
import { ProblemDetailsFilter } from './problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from './request-context';
import { TenantApplicationService } from './tenant-application.service';

@Controller('v1')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class TenantController {
  constructor(
    @Inject(TenantApplicationService) private readonly service: TenantApplicationService,
  ) {}

  @Post('tenants')
  @HttpCode(201)
  async createTenant(
    @Req() request: RequestWithContext,
    @Body() rawBody: unknown,
  ): Promise<TenantResponse> {
    const body = this.parseCreateTenantRequest(rawBody);
    return this.service.createTenant({
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      body,
    });
  }

  @Get('tenants/:tenantId')
  async getTenant(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
  ): Promise<TenantResponse> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    if (!tenantId.success) {
      throw new ApplicationError(
        400,
        'invalid_tenant_id',
        'Bad Request',
        'The tenant ID is invalid.',
      );
    }

    return this.service.getTenant({
      tenantId: tenantId.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    });
  }

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  async getMe(@Req() request: RequestWithContext): Promise<MeResponse> {
    return this.service.getMe(requirePrincipal(request).userId);
  }

  private parseCreateTenantRequest(rawBody: unknown): CreateTenantRequest {
    const result = createTenantRequestSchema.safeParse(rawBody);
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
