import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  customerIdSchema,
  customerNoteIdSchema,
  tenantIdSchema,
  type CustomerNote,
} from '@nook/contracts';

import { ApplicationError } from '../../../platform/http/application-error';
import { ProblemDetailsFilter } from '../../../platform/http/problem-details.filter';
import {
  requirePrincipal,
  requireRequestId,
  type RequestWithContext,
} from '../../../platform/http/request-context';
import { AuthenticationGuard } from '../../../platform/identity/authentication.guard';
import { CustomerNotesApplicationService } from './customer-notes-application.service';

@Controller('v1/tenants/:tenantId/customers/:customerId/notes')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class CustomerNotesController {
  constructor(
    @Inject(CustomerNotesApplicationService)
    private readonly service: CustomerNotesApplicationService,
  ) {}

  @Post()
  create(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
    @Body() body: unknown,
  ): Promise<CustomerNote> {
    return this.service.create({ ...context(request, rawTenantId, rawCustomerId), body });
  }

  @Patch(':noteId')
  update(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
    @Param('noteId') rawNoteId: string,
    @Body() body: unknown,
  ): Promise<CustomerNote> {
    return this.service.update({
      ...context(request, rawTenantId, rawCustomerId),
      noteId: parseNoteId(rawNoteId),
      body,
    });
  }

  @Delete(':noteId')
  @HttpCode(204)
  delete(
    @Req() request: RequestWithContext,
    @Param('tenantId') rawTenantId: string,
    @Param('customerId') rawCustomerId: string,
    @Param('noteId') rawNoteId: string,
  ): Promise<void> {
    return this.service.delete({
      ...context(request, rawTenantId, rawCustomerId),
      noteId: parseNoteId(rawNoteId),
    });
  }
}

function context(request: RequestWithContext, rawTenantId: string, rawCustomerId: string) {
  const tenantId = tenantIdSchema.safeParse(rawTenantId);
  const customerId = customerIdSchema.safeParse(rawCustomerId);
  if (!tenantId.success) throw invalidRequest();
  if (!customerId.success) throw customerNotFound();
  return {
    tenantId: tenantId.data,
    customerId: customerId.data,
    userId: requirePrincipal(request).userId,
    requestId: requireRequestId(request),
  };
}

function parseNoteId(value: string): string {
  const noteId = customerNoteIdSchema.safeParse(value);
  if (!noteId.success) throw noteNotFound();
  return noteId.data;
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

function noteNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_note_not_found',
    'Not Found',
    'The note was not found.',
  );
}
