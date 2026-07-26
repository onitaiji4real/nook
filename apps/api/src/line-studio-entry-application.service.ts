import { Inject, Injectable } from '@nestjs/common';
import { resolveStudioNavigation, type MerchantStudioEntryEventRequest } from '@nook/contracts';
import type { TenantRepository } from '@nook/database';
import { redactValue } from '@nook/observability';

import { ApplicationError } from './application-error';
import { TENANT_REPOSITORY } from './tenant-repository.token';
import { UserAccessService } from './user-access.service';

@Injectable()
export class LineStudioEntryApplicationService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(UserAccessService) private readonly users: UserAccessService,
  ) {}

  async record(input: {
    readonly userId: string;
    readonly requestId: string;
    readonly event: MerchantStudioEntryEventRequest;
  }): Promise<void> {
    await this.users.requireActive(input.userId);
    const membership = await this.tenants.findActiveTenantMembership({
      tenantId: input.event.tenantId,
      userId: input.userId,
    });

    if (membership === null) {
      this.writeEvent({
        requestId: input.requestId,
        operation: 'line.merchant_entry',
        outcome: 'denied',
        routeKey: input.event.routeKey,
        httpStatus: 403,
      });
      throw new ApplicationError(
        403,
        'tenant_access_denied',
        'Forbidden',
        'Access to this tenant is denied.',
      );
    }

    this.writeEvent({
      requestId: input.requestId,
      operation: 'line.merchant_entry',
      outcome:
        resolveStudioNavigation({
          routeKey: input.event.routeKey,
          role: membership.membership.role,
        }).access === 'fallback'
          ? 'fallback'
          : 'success',
      routeKey: input.event.routeKey,
      httpStatus: 204,
      tenantId: input.event.tenantId,
    });
  }

  private writeEvent(
    event: Readonly<{
      requestId: string;
      operation: 'line.merchant_entry';
      outcome: 'success' | 'fallback' | 'denied';
      routeKey: MerchantStudioEntryEventRequest['routeKey'];
      httpStatus: number;
      tenantId?: string;
    }>,
  ): void {
    process.stdout.write(`${JSON.stringify(redactValue(event))}\n`);
  }
}
