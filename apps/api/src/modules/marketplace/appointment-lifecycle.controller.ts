import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { tenantIdSchema, type AppointmentTransitionResponse } from '@nook/contracts';

import { ApplicationError } from '../../application-error';
import { AuthenticationGuard } from '../../authentication.guard';
import { ProblemDetailsFilter } from '../../problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from '../../request-context';
import { AppointmentLifecycleApplicationService } from './appointment-lifecycle-application.service';

@Controller('v1')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class AppointmentLifecycleController {
  constructor(
    @Inject(AppointmentLifecycleApplicationService)
    private readonly service: AppointmentLifecycleApplicationService,
  ) {}

  @Post('me/appointments/:appointmentId/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  consumerCancel(
    @Req() request: RequestWithContext,
    @Param('appointmentId') appointmentId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ): Promise<AppointmentTransitionResponse> {
    return this.service.consumerCancel({
      actorUserId: requirePrincipal(request).userId,
      rawAppointmentId: appointmentId,
      rawIdempotencyKey: key,
      body,
      requestId: requireRequestId(request),
    });
  }

  @Post('me/appointments/:appointmentId/reschedule')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  consumerReschedule(
    @Req() request: RequestWithContext,
    @Param('appointmentId') appointmentId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ): Promise<AppointmentTransitionResponse> {
    return this.service.consumerReschedule({
      actorUserId: requirePrincipal(request).userId,
      rawAppointmentId: appointmentId,
      rawIdempotencyKey: key,
      body,
      requestId: requireRequestId(request),
    });
  }

  @Post('tenants/:tenantId/appointments/:appointmentId/:action')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  merchantTransition(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Param('action') rawAction: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ): Promise<AppointmentTransitionResponse> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    if (!tenantId.success) return invalidRequest();
    const endpoints = {
      cancel: 'merchant.cancel',
      'check-in': 'merchant.check_in',
      complete: 'merchant.complete',
      'no-show': 'merchant.no_show',
    } as const;
    const endpoint = endpoints[rawAction as keyof typeof endpoints];
    if (endpoint === undefined) return invalidRequest();
    return this.service.merchantTransition({
      actorUserId: requirePrincipal(request).userId,
      tenantId: tenantId.data,
      rawAppointmentId: appointmentId,
      rawIdempotencyKey: key,
      endpoint,
      body,
      requestId: requireRequestId(request),
    });
  }
}

function invalidRequest(): never {
  throw new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}
