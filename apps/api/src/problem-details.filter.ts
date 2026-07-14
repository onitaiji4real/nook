import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
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
    const applicationError =
      error instanceof ApplicationError
        ? error
        : new ApplicationError(
            503,
            'internal_error',
            'Service Unavailable',
            'The request could not be completed.',
          );

    const problem: ProblemDetails = {
      type: `https://nook.example/problems/${applicationError.code}`,
      title: applicationError.title,
      status: applicationError.status,
      detail: applicationError.detail,
      instance: request.originalUrl,
      requestId: requireRequestId(request),
      code: applicationError.code,
    };

    response.status(applicationError.status).type('application/problem+json').send(problem);
  }
}
