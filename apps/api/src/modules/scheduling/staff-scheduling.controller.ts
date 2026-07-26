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
  availabilityExceptionIdSchema,
  changeAvailabilityExceptionStatusRequestSchema,
  changeStaffStatusRequestSchema,
  createAvailabilityExceptionRequestSchema,
  createStaffRequestSchema,
  reorderStaffRequestSchema,
  replaceWeeklyAvailabilityRequestSchema,
  staffIdSchema,
  tenantIdSchema,
  updateAvailabilityExceptionRequestSchema,
  updateStaffRequestSchema,
  type ChangeAvailabilityExceptionStatusRequest,
  type ChangeStaffStatusRequest,
  type CreateAvailabilityExceptionRequest,
  type ReorderStaffRequest,
  type ReplaceWeeklyAvailabilityRequest,
  type StaffAvailabilityResponse,
  type UpdateAvailabilityExceptionRequest,
  type UpdateStaffRequest,
} from '@nook/contracts';
import { ApplicationError } from '../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../platform/http/request-context';
import { AuthenticationGuard } from '../../platform/identity/authentication.guard';
import { StaffSchedulingApplicationService } from './staff-scheduling-application.service';

interface SafeParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

@Controller('v1/tenants/:tenantId/staff')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class StaffSchedulingController {
  constructor(
    @Inject(StaffSchedulingApplicationService)
    private readonly service: StaffSchedulingApplicationService,
  ) {}

  @Get()
  list(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.list(this.context(request, tenantId));
  }

  @Post()
  create(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.create({
      ...this.context(request, tenantId),
      body: this.parse(createStaffRequestSchema, body),
    });
  }

  @Put('order')
  reorder(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.reorder({
      ...this.context(request, tenantId),
      body: this.parse<ReorderStaffRequest>(reorderStaffRequestSchema, body),
    });
  }

  @Patch(':staffId')
  update(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.update({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      body: this.parse<UpdateStaffRequest>(updateStaffRequestSchema, body),
    });
  }

  @Put(':staffId/status')
  changeStatus(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.changeStatus({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      body: this.parse<ChangeStaffStatusRequest>(changeStaffStatusRequestSchema, body),
    });
  }

  @Put(':staffId/weekly-schedule')
  replaceWeeklyAvailability(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.replaceWeeklyAvailability({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      body: this.parse<ReplaceWeeklyAvailabilityRequest>(
        replaceWeeklyAvailabilityRequestSchema,
        body,
      ),
    });
  }

  @Post(':staffId/exceptions')
  createException(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.createException({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      body: this.parse<CreateAvailabilityExceptionRequest>(
        createAvailabilityExceptionRequestSchema,
        body,
      ),
    });
  }

  @Patch(':staffId/exceptions/:exceptionId')
  updateException(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Param('exceptionId') exceptionId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.updateException({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      exceptionId: this.id(availabilityExceptionIdSchema, exceptionId, 'invalid_exception_id'),
      body: this.parse<UpdateAvailabilityExceptionRequest>(
        updateAvailabilityExceptionRequestSchema,
        body,
      ),
    });
  }

  @Put(':staffId/exceptions/:exceptionId/status')
  changeExceptionStatus(
    @Req() request: RequestWithContext,
    @Param('tenantId') tenantId: string,
    @Param('staffId') staffId: string,
    @Param('exceptionId') exceptionId: string,
    @Body() body: unknown,
  ): Promise<StaffAvailabilityResponse> {
    return this.service.changeExceptionStatus({
      ...this.context(request, tenantId),
      staffId: this.id(staffIdSchema, staffId, 'invalid_staff_id'),
      exceptionId: this.id(availabilityExceptionIdSchema, exceptionId, 'invalid_exception_id'),
      body: this.parse<ChangeAvailabilityExceptionStatusRequest>(
        changeAvailabilityExceptionStatusRequestSchema,
        body,
      ),
    });
  }

  private context(request: RequestWithContext, rawTenantId: string) {
    const tenantId = this.id(tenantIdSchema, rawTenantId, 'invalid_tenant_id');
    return {
      tenantId,
      userId: requirePrincipal(request).userId,
      requestId: requireRequestId(request),
    };
  }

  private id(schema: SafeParser<string>, value: string, code: string): string {
    const parsed = schema.safeParse(value);
    if (!parsed.success) this.invalid(code, 'The resource ID is invalid.');
    return parsed.data;
  }

  private parse<T>(schema: SafeParser<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) this.invalid('invalid_request', 'The request body is invalid.');
    return parsed.data;
  }

  private invalid(code: string, detail: string): never {
    throw new ApplicationError(400, code, 'Bad Request', detail);
  }
}
