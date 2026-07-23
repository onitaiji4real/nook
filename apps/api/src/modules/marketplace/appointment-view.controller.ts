import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  canonicalAppointmentIdSchema,
  consumerAppointmentListQuerySchema,
  merchantAppointmentListQuerySchema,
  tenantIdSchema,
  type ConsumerAppointmentDetail,
  type ConsumerAppointmentListResponse,
  type MerchantAppointmentDetail,
  type MerchantAppointmentListResponse,
} from '@nook/contracts';

import { ApplicationError } from '../../application-error';
import { AuthenticationGuard } from '../../authentication.guard';
import { ProblemDetailsFilter } from '../../problem-details.filter';
import { requirePrincipal, requireRequestId, type RequestWithContext } from '../../request-context';
import { AppointmentViewApplicationService } from './appointment-view-application.service';

@Controller('v1')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class AppointmentViewController {
  constructor(
    @Inject(AppointmentViewApplicationService)
    private readonly service: AppointmentViewApplicationService,
  ) {}

  @Get('me/appointments')
  @Header('Cache-Control', 'private, no-store')
  listConsumer(
    @Req() request: RequestWithContext,
    @Query() rawQuery: unknown,
  ): Promise<ConsumerAppointmentListResponse> {
    const query = consumerAppointmentListQuerySchema.safeParse(rawQuery);
    if (!query.success) throw invalidRequest();
    return this.service.listConsumer({
      consumerUserId: requirePrincipal(request).userId,
      query: query.data,
    });
  }

  @Get('me/appointments/:appointmentId')
  @Header('Cache-Control', 'private, no-store')
  getConsumer(
    @Req() request: RequestWithContext,
    @Param('appointmentId') rawAppointmentId: string,
  ): Promise<ConsumerAppointmentDetail> {
    const appointmentId = canonicalAppointmentIdSchema.safeParse(rawAppointmentId);
    if (!appointmentId.success) throw appointmentNotFound();
    return this.service.getConsumer({
      consumerUserId: requirePrincipal(request).userId,
      appointmentId: appointmentId.data,
    });
  }

  @Get('tenants/:tenantId/appointments')
  @Header('Cache-Control', 'private, no-store')
  listMerchant(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Query() rawQuery: unknown,
  ): Promise<MerchantAppointmentListResponse> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    const query = merchantAppointmentListQuerySchema.safeParse(rawQuery);
    if (!tenantId.success || !query.success) throw invalidRequest();
    return this.service.listMerchant({
      tenantId: tenantId.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      query: query.data,
    });
  }

  @Get('tenants/:tenantId/appointments/:appointmentId')
  @Header('Cache-Control', 'private, no-store')
  getMerchant(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('appointmentId') rawAppointmentId: string,
  ): Promise<MerchantAppointmentDetail> {
    const tenantId = tenantIdSchema.safeParse(rawTenantId);
    if (!tenantId.success) throw invalidRequest();
    const appointmentId = canonicalAppointmentIdSchema.safeParse(rawAppointmentId);
    if (!appointmentId.success) throw appointmentNotFound();
    return this.service.getMerchant({
      tenantId: tenantId.data,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
      appointmentId: appointmentId.data,
    });
  }
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function appointmentNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'appointment_not_found',
    'Not Found',
    'The appointment was not found.',
  );
}
