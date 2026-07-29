import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { tenantIdSchema, type BookingPolicyResponse } from '@nook/contracts';

import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';
import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { BookingPolicyApplicationService } from './booking-policy-application.service';

@Controller('v1/tenants/:tenantId/booking-policy')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class BookingPolicyController {
  constructor(
    @Inject(BookingPolicyApplicationService)
    private readonly service: BookingPolicyApplicationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
  ): Promise<BookingPolicyResponse> {
    return this.service.get({
      tenantId: parseTenantId(rawTenantId),
      actorUserId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    });
  }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  update(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Body() body: unknown,
  ): Promise<BookingPolicyResponse> {
    return this.service.update({
      tenantId: parseTenantId(rawTenantId),
      actorUserId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      body,
    });
  }
}

function parseTenantId(rawTenantId: string): string {
  const tenantId = tenantIdSchema.safeParse(rawTenantId);
  if (tenantId.success) return tenantId.data;
  throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}
