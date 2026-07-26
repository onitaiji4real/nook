import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ProblemDetails } from '@nook/contracts';
import type { Response } from 'express';

import { ApplicationError } from './application-error';
import { requireRequestId, type RequestWithContext } from './request-context';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const applicationError = toApplicationError(error);

    const problem: ProblemDetails = {
      type: `https://nook.example/problems/${applicationError.code}`,
      title: applicationError.title,
      status: applicationError.status,
      detail: applicationError.detail,
      instance: request.originalUrl,
      requestId: requireRequestId(request),
      code: applicationError.code,
    };

    if (applicationError.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(applicationError.retryAfterSeconds));
    }

    response.status(applicationError.status).type('application/problem+json').send(problem);
  }
}

function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (error instanceof HttpException && error.getStatus() === 413) {
    return new ApplicationError(
      413,
      'request_payload_too_large',
      'Content Too Large',
      'The request payload is too large.',
    );
  }
  return new ApplicationError(
    503,
    'internal_error',
    'Service Unavailable',
    'The request could not be completed.',
  );
}
