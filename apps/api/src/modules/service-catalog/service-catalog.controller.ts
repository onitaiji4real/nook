import {
  Body,
  Controller,
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
  changeServiceStatusRequestSchema,
  createServiceRequestSchema,
  reorderServicesRequestSchema,
  serviceIdSchema,
  tenantIdSchema,
  updateServiceRequestSchema,
  type ChangeServiceStatusRequest,
  type CreateServiceRequest,
  type ReorderServicesRequest,
  type ServiceCatalogResponse,
  type UpdateServiceRequest,
} from '@nook/contracts';

import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';
import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { ServiceCatalogApplicationService } from './service-catalog-application.service';

@Controller('v1/tenants/:tenantId/services')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class ServiceCatalogController {
  constructor(
    @Inject(ServiceCatalogApplicationService)
    private readonly service: ServiceCatalogApplicationService,
  ) {}

  @Get()
  list(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
  ): Promise<ServiceCatalogResponse> {
    return this.service.list(this.context(request, tenantId));
  }

  @Post()
  create(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<ServiceCatalogResponse> {
    return this.service.create({
      ...this.context(request, tenantId),
      body: this.parseCreate(body),
    });
  }

  @Put('order')
  reorder(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<ServiceCatalogResponse> {
    return this.service.reorder({
      ...this.context(request, tenantId),
      body: this.parseReorder(body),
    });
  }

  @Patch(':serviceId')
  update(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<ServiceCatalogResponse> {
    return this.service.update({
      ...this.context(request, tenantId),
      serviceId: this.parseServiceId(serviceId),
      body: this.parseUpdate(body),
    });
  }

  @Put(':serviceId/status')
  changeStatus(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<ServiceCatalogResponse> {
    return this.service.changeStatus({
      ...this.context(request, tenantId),
      serviceId: this.parseServiceId(serviceId),
      body: this.parseStatus(body),
    });
  }

  private context(request: RequestWithContext, rawTenantId: string) {
    const parsed = tenantIdSchema.safeParse(rawTenantId);
    if (!parsed.success) this.invalid('invalid_tenant_id', 'The tenant ID is invalid.');
    return {
      tenantId: parsed.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    };
  }

  private parseServiceId(rawServiceId: string): string {
    const parsed = serviceIdSchema.safeParse(rawServiceId);
    if (!parsed.success) this.invalid('invalid_service_id', 'The service ID is invalid.');
    return parsed.data;
  }

  private parseCreate(body: unknown): CreateServiceRequest {
    const parsed = createServiceRequestSchema.safeParse(body);
    if (!parsed.success) this.invalid('invalid_request', 'The request body is invalid.');
    return parsed.data;
  }

  private parseUpdate(body: unknown): UpdateServiceRequest {
    const parsed = updateServiceRequestSchema.safeParse(body);
    if (!parsed.success) this.invalid('invalid_request', 'The request body is invalid.');
    return parsed.data;
  }

  private parseStatus(body: unknown): ChangeServiceStatusRequest {
    const parsed = changeServiceStatusRequestSchema.safeParse(body);
    if (!parsed.success) this.invalid('invalid_request', 'The request body is invalid.');
    return parsed.data;
  }

  private parseReorder(body: unknown): ReorderServicesRequest {
    const parsed = reorderServicesRequestSchema.safeParse(body);
    if (!parsed.success) this.invalid('invalid_request', 'The request body is invalid.');
    return parsed.data;
  }

  private invalid(code: string, detail: string): never {
    throw new ApplicationError(400, code, 'Bad Request', detail);
  }
}
