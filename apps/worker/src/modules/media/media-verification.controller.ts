import { Body, Controller, Headers, HttpException, Inject, Post, Req } from '@nestjs/common';
import { verifyMediaTaskRequestSchema, type VerifyMediaTaskResponse } from '@nook/contracts';

import { requireRequestId, type RequestWithContext } from '../../request-context';
import {
  MediaVerificationRequestError,
  MediaVerificationService,
} from './media-verification.service';

@Controller('internal/media')
export class MediaVerificationController {
  constructor(
    @Inject(MediaVerificationService) private readonly service: MediaVerificationService,
  ) {}

  @Post('verify')
  async verify(
    @Req() request: RequestWithContext,
    @Headers('x-cloudtasks-queuename') queueName: string | undefined,
    @Body() body: unknown,
  ): Promise<VerifyMediaTaskResponse> {
    try {
      this.service.requireQueue(queueName);
      const parsed = verifyMediaTaskRequestSchema.safeParse(body);
      if (!parsed.success) throw new MediaVerificationRequestError(400, 'invalid_media_task');
      const requestId = requireRequestId(request);
      return await this.service.verify({ ...parsed.data, requestId });
    } catch (error) {
      if (error instanceof MediaVerificationRequestError) {
        throw new HttpException({ status: error.status, code: error.code }, error.status);
      }
      throw error;
    }
  }
}
