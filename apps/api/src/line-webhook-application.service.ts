import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import type { LineWebhookRepository } from '@nook/database';
import {
  LineWebhookError,
  lineWebhookMaxBytes,
  parseVerifiedLineWebhook,
  verifyLineWebhookSignature,
} from '@nook/line';

import { ApplicationError } from './application-error';
import { LINE_WEBHOOK_REPOSITORY } from './line-webhook.tokens';
import { RUNTIME_CONFIG } from './runtime-config.token';

@Injectable()
export class LineWebhookApplicationService {
  constructor(
    @Inject(LINE_WEBHOOK_REPOSITORY) private readonly repository: LineWebhookRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async receive(input: {
    readonly rawBody: Uint8Array | undefined;
    readonly signature: string | undefined;
    readonly requestId: string;
  }): Promise<{
    readonly accepted: true;
    readonly processedCount: number;
    readonly replayedCount: number;
  }> {
    const notification = this.config.notification;
    if (notification.mode !== 'line_push' || notification.service !== 'api') {
      this.log(input.requestId, 'unavailable', 503, 0);
      throw new ApplicationError(
        503,
        'line_webhook_unavailable',
        'Service Unavailable',
        'The LINE webhook is not enabled.',
      );
    }
    if (input.rawBody !== undefined && input.rawBody.byteLength > lineWebhookMaxBytes) {
      this.log(input.requestId, 'rejected', 413, 0);
      throw new ApplicationError(
        413,
        'line_webhook_payload_too_large',
        'Content Too Large',
        'The webhook payload is invalid.',
      );
    }
    if (
      input.rawBody === undefined ||
      !verifyLineWebhookSignature(input.rawBody, input.signature, notification.channelSecret)
    ) {
      this.log(input.requestId, 'rejected', 401, 0);
      throw new ApplicationError(
        401,
        'line_webhook_signature_invalid',
        'Unauthorized',
        'The webhook signature is invalid.',
      );
    }

    let events;
    try {
      events = parseVerifiedLineWebhook(input.rawBody);
    } catch (error) {
      if (error instanceof LineWebhookError) {
        const status = error.code === 'payload_too_large' ? 413 : 400;
        this.log(input.requestId, 'rejected', status, 0);
        throw new ApplicationError(
          status,
          error.code === 'payload_too_large'
            ? 'line_webhook_payload_too_large'
            : 'line_webhook_payload_invalid',
          status === 413 ? 'Content Too Large' : 'Bad Request',
          'The webhook payload is invalid.',
        );
      }
      throw error;
    }

    let replayedCount = 0;
    for (const event of events) {
      const result = await this.repository.record({
        webhookEventId: event.webhookEventId,
        eventType: event.eventType,
        routedType: event.routedType,
        sourceType: event.sourceType,
        ...(event.providerSubject === undefined ? {} : { providerSubject: event.providerSubject }),
        providerTimestamp: new Date(event.timestamp),
        payloadJson: event.payload,
      });
      if (result.replayed) replayedCount += 1;
    }
    this.log(
      input.requestId,
      replayedCount === events.length ? 'replayed' : 'success',
      200,
      events.length,
    );
    return { accepted: true, processedCount: events.length, replayedCount };
  }

  private log(
    requestId: string,
    outcome: 'success' | 'replayed' | 'rejected' | 'unavailable',
    httpStatus: number,
    count: number,
  ): void {
    process.stdout.write(
      `${JSON.stringify({
        severity: httpStatus >= 500 ? 'ERROR' : httpStatus >= 400 ? 'WARNING' : 'INFO',
        service: 'api',
        operation: 'line.webhook.receive',
        outcome,
        requestId,
        httpStatus,
        count,
      })}\n`,
    );
  }
}
