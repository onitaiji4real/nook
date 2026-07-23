import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  bookingHoldIdSchema,
  bookingHoldIdempotencyKeySchema,
  type BookingHoldResponse,
} from '@nook/contracts';

import { ApplicationError } from '../../application-error';
import { AuthenticationGuard } from '../../authentication.guard';
import { ProblemDetailsFilter } from '../../problem-details.filter';
import { requirePrincipal, type RequestWithContext } from '../../request-context';
import { BookingHoldApplicationService } from './booking-hold-application.service';

@Controller('v1/marketplace/merchants/:slug/booking-holds')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class MarketplaceBookingHoldController {
  constructor(
    @Inject(BookingHoldApplicationService)
    private readonly service: BookingHoldApplicationService,
  ) {}

  @Post()
  create(
    @Req() request: RequestWithContext,
    @Param('slug') rawSlug: string,
    @Headers('idempotency-key') rawIdempotencyKey: unknown,
    @Body() rawBody: unknown,
  ): Promise<BookingHoldResponse> {
    const idempotencyKey = bookingHoldIdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!idempotencyKey.success) throw invalidRequest();
    return this.service.create({
      consumerUserId: requirePrincipal(request).userId,
      slug: rawSlug,
      idempotencyKey: idempotencyKey.data,
      body: rawBody,
    });
  }
}

@Controller('v1/booking-holds')
@UseGuards(AuthenticationGuard)
@UseFilters(ProblemDetailsFilter)
export class BookingHoldController {
  constructor(
    @Inject(BookingHoldApplicationService)
    private readonly service: BookingHoldApplicationService,
  ) {}

  @Delete(':holdId')
  @HttpCode(204)
  async release(
    @Req() request: RequestWithContext,
    @Param('holdId') rawHoldId: string,
  ): Promise<void> {
    const holdId = bookingHoldIdSchema.safeParse(rawHoldId);
    if (!holdId.success) throw notFound();
    await this.service.release({
      consumerUserId: requirePrincipal(request).userId,
      holdId: holdId.data,
    });
  }
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function notFound(): ApplicationError {
  return new ApplicationError(
    404,
    'booking_hold_not_found',
    'Not Found',
    'The booking hold was not found.',
  );
}
