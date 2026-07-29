import { Controller, Get, Inject, Param, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import {
  customerIdSchema,
  customerListQuerySchema,
  tenantIdSchema,
  type CustomerDetail,
  type CustomerListResponse,
} from '@nook/contracts';

import { ApplicationError } from '../../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../../platform/http/request-context';
import { AuthenticationGuard } from '../../../platform/identity/authentication.guard';
import { CustomerReadApplicationService } from './customer-read-application.service';

@Controller('v1/tenants/:tenantId/customers')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class CustomerReadController {
  constructor(
    @Inject(CustomerReadApplicationService)
    private readonly service: CustomerReadApplicationService,
  ) {}

  @Get()
  list(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Query() rawQuery: unknown,
  ): Promise<CustomerListResponse> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    const query = customerListQuerySchema.safeParse(rawQuery);
    if (!tenantId.success || !query.success) throw invalidRequest();
    return this.service.list({
      tenantId: tenantId.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      query: query.data,
    });
  }

  @Get(':customerId')
  getDetail(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
  ): Promise<CustomerDetail> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    if (!tenantId.success) throw invalidRequest();
    const customerId = customerIdSchema.safeParse(rawCustomerId);
    if (!customerId.success) throw customerNotFound();
    return this.service.getDetail({
      tenantId: tenantId.data,
      customerId: customerId.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    });
  }
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function customerNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_not_found',
    'Not Found',
    'The customer was not found.',
  );
}
