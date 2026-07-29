import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  customerIdSchema,
  customerTagIdSchema,
  tenantIdSchema,
  type CustomerTagDefinition,
} from '@nook/contracts';

import { ApplicationError } from '../../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../../platform/http/request-context';
import { AuthenticationGuard } from '../../../platform/identity/authentication.guard';
import { CustomerTagsApplicationService } from './customer-tags-application.service';

@Controller('v1/tenants/:tenantId')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class CustomerTagsController {
  constructor(
    @Inject(CustomerTagsApplicationService)
    private readonly service: CustomerTagsApplicationService,
  ) {}

  @Get('customer-tags')
  list(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
  ): Promise<readonly CustomerTagDefinition[]> {
    return this.service.list(context(request, rawTenantId));
  }

  @Post('customer-tags')
  create(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Body() body: unknown,
  ): Promise<CustomerTagDefinition> {
    return this.service.create({ ...context(request, rawTenantId), body });
  }

  @Put('customer-tags/:tagId/status')
  changeStatus(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('tagId') rawTagId: string,
    @Body() body: unknown,
  ): Promise<CustomerTagDefinition> {
    return this.service.changeStatus({
      ...context(request, rawTenantId),
      tagId: parseTagId(rawTagId),
      body,
    });
  }

  @Put('customers/:customerId/tags/:tagId')
  @HttpCode(204)
  attach(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
    @Param('tagId') rawTagId: string,
  ): Promise<void> {
    return this.service.attach({
      ...context(request, rawTenantId),
      customerId: parseCustomerId(rawCustomerId),
      tagId: parseTagId(rawTagId),
    });
  }

  @Delete('customers/:customerId/tags/:tagId')
  @HttpCode(204)
  detach(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
    @Param('tagId') rawTagId: string,
  ): Promise<void> {
    return this.service.detach({
      ...context(request, rawTenantId),
      customerId: parseCustomerId(rawCustomerId),
      tagId: parseTagId(rawTagId),
    });
  }
}

function context(request: RequestWithContext, rawTenantId: string) {
  const tenantId = tenantIdSchema.safeParse(rawTenantId);
  if (!tenantId.success) throw invalidRequest();
  return {
    tenantId: tenantId.data,
    userId: requirePrincipal(request).userId,
    requestId: requireRequestId(request),
  };
}

function parseTagId(value: string): string {
  const parsed = customerTagIdSchema.safeParse(value);
  if (!parsed.success) throw tagNotFound();
  return parsed.data;
}

function parseCustomerId(value: string): string {
  const parsed = customerIdSchema.safeParse(value);
  if (!parsed.success) throw customerNotFound();
  return parsed.data;
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function tagNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_tag_not_found',
    'Not Found',
    'The customer tag was not found.',
  );
}

function customerNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_not_found',
    'Not Found',
    'The customer was not found.',
  );
}
