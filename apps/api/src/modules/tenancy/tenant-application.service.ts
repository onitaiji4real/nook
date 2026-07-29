import { Inject, Injectable } from '@nestjs/common';
import type { CreateTenantRequest, MeResponse, TenantResponse } from '@nook/contracts';
import type { RuntimeConfig } from '@nook/config';
import { classifyTenantConflict, type TenantRepository } from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../platform/config/runtime-config.token';
import { ApplicationError } from '../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../platform/identity/tenant-repository.token';
import { UserAccessService } from '../../platform/identity/user-access.service';

@Injectable()
export class TenantApplicationService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly repository: TenantRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(UserAccessService) private readonly users: UserAccessService,
  ) {}

  async createTenant(input: {
    readonly userId: string;
    readonly requestId: string;
    readonly body: CreateTenantRequest;
  }): Promise<TenantResponse> {
    await this.users.requireActive(input.userId);
    try {
      const record = await this.repository.createTenantWithOwner({
        ownerUserId: input.userId,
        name: input.body.name,
        slug: input.body.slug,
        requestId: input.requestId,
      });

      this.writeSecurityEvent({
        event: 'tenant.created',
        requestId: input.requestId,
        actorUserId: input.userId,
        tenantId: record.tenant.id,
        outcome: 'success',
        version: this.config.appVersion,
        environment: this.config.nodeEnv,
      });

      return { ...record.tenant, membership: record.membership };
    } catch (error) {
      const conflict = classifyTenantConflict(error);
      if (conflict !== null) {
        throw new ApplicationError(
          409,
          conflict,
          'Conflict',
          conflict === 'duplicate_slug'
            ? 'The tenant slug is already in use.'
            : 'The membership already exists.',
        );
      }

      throw error;
    }
  }

  async getTenant(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  }): Promise<TenantResponse> {
    const record = await this.repository.findActiveTenantMembership({
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (record === null) {
      await this.repository.recordAuthorizationDeniedIfTenantExists({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
      });
      this.writeSecurityEvent({
        event: 'authorization.denied',
        requestId: input.requestId,
        actorUserId: input.userId,
        tenantId: input.tenantId,
        outcome: 'denied',
        version: this.config.appVersion,
        environment: this.config.nodeEnv,
      });
      throw new ApplicationError(
        403,
        'tenant_access_denied',
        'Forbidden',
        'Access to this tenant is denied.',
      );
    }

    return { ...record.tenant, membership: record.membership };
  }

  async getMe(userId: string): Promise<MeResponse> {
    await this.users.requireActive(userId);
    const memberships = await this.repository.listMembershipsForUser(userId);
    return { id: userId, memberships };
  }

  private writeSecurityEvent(input: Parameters<typeof createSecurityEventLog>[0]): void {
    process.stdout.write(`${JSON.stringify(redactValue(createSecurityEventLog(input)))}\n`);
  }
}
