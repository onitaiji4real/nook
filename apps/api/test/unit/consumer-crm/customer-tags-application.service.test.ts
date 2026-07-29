import type { RuntimeConfig } from '@nook/config';
import {
  CustomerTagRepositoryError,
  type CustomerTagRepository,
  type TenantRepository,
} from '@nook/database';
import { describe, expect, it, vi } from 'vitest';

import { CustomerTagsApplicationService } from '../../../src/modules/consumer-crm/tags/customer-tags-application.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const tagId = '00000000-0000-4000-8000-000000000003';
const customerId = '00000000-0000-4000-8000-000000000004';

const baseConfig: RuntimeConfig = {
  nodeEnv: 'test',
  port: 8080,
  appVersion: 'test',
  apiCorsAllowedOrigins: [],
  appointmentConfirmationEnabled: true,
  bookingPolicyV2WritesEnabled: true,
  appointmentLifecycleEnabled: true,
  crmProjectionMode: 'disabled',
  crmTagsMode: 'active',
  crmNotesMode: 'disabled',
  marketingConsentGrantEnabled: false,
  lineAuthRateLimit: {
    globalLimit: 120,
    tokenLimit: 5,
    windowSeconds: 60,
    bucketTtlSeconds: 600,
  },
  identity: { mode: 'disabled' },
  media: { mode: 'disabled' },
  notification: { mode: 'disabled' },
};

describe('CustomerTagsApplicationService', () => {
  it('normalizes an allowed owner-created definition before persistence', async () => {
    const repository = createRepository();
    repository.createDefinition.mockResolvedValue({
      id: tagId,
      displayName: 'VIP 客戶',
      status: 'ACTIVE',
    });
    const service = createService(repository, createTenants('OWNER'));

    await expect(
      service.create({ ...context(), body: { name: '  ＶＩＰ 客戶  ' } }),
    ).resolves.toEqual({
      id: tagId,
      name: 'VIP 客戶',
      status: 'ACTIVE',
    });
    expect(repository.createDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        actorUserId: userId,
        normalizedName: 'vip 客戶',
        displayName: 'VIP 客戶',
      }),
    );
  });

  it('rejects sensitive classifications before touching persistence', async () => {
    const repository = createRepository();
    const service = createService(repository, createTenants('OWNER'));

    await expect(
      service.create({ ...context(), body: { name: '醫療需求' } }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'customer_tag_sensitive_category',
    });
    expect(repository.createDefinition).not.toHaveBeenCalled();
  });

  it('allows managers to list and attach but not administer definitions', async () => {
    const repository = createRepository();
    repository.listDefinitions.mockResolvedValue([]);
    repository.attach.mockResolvedValue(true);
    const tenants = createTenants('MANAGER');
    const service = createService(repository, tenants);

    await expect(service.list(context())).resolves.toEqual([]);
    await expect(service.attach({ ...context(), customerId, tagId })).resolves.toBeUndefined();
    await expect(
      service.changeStatus({ ...context(), tagId, body: { status: 'INACTIVE' } }),
    ).rejects.toMatchObject({ status: 403, code: 'tenant_access_denied' });
    expect(tenants.recordAuthorizationDeniedIfTenantExists).toHaveBeenCalled();
  });

  it('returns non-disclosing 404 for a user outside the tenant', async () => {
    const repository = createRepository();
    const tenants = createTenants(null);
    const service = createService(repository, tenants);

    await expect(service.list(context())).rejects.toMatchObject({
      status: 404,
      code: 'customer_tag_not_found',
    });
    expect(repository.listDefinitions).not.toHaveBeenCalled();
  });

  it('fails closed before persistence while the runtime gate is disabled', async () => {
    const repository = createRepository();
    const service = createService(repository, createTenants('OWNER'), {
      ...baseConfig,
      crmTagsMode: 'disabled',
      crmNotesMode: 'disabled',
    });

    await expect(service.list(context())).rejects.toMatchObject({
      status: 503,
      code: 'customer_tags_unavailable',
    });
    expect(repository.listDefinitions).not.toHaveBeenCalled();
  });

  it('maps entitlement denial without branching on plan names', async () => {
    const repository = createRepository();
    repository.listDefinitions.mockRejectedValue(
      new CustomerTagRepositoryError('entitlement_denied'),
    );
    const service = createService(repository, createTenants('OWNER'));

    await expect(service.list(context())).rejects.toMatchObject({
      status: 403,
      code: 'customer_tags_not_in_plan',
    });
  });
});

function context() {
  return { tenantId, userId, requestId: 'request-tags' };
}

function createService(
  repository: ReturnType<typeof createRepository>,
  tenants: ReturnType<typeof createTenants>,
  config: RuntimeConfig = baseConfig,
): CustomerTagsApplicationService {
  return new CustomerTagsApplicationService(repository, tenants, config);
}

function createRepository() {
  return {
    access: vi.fn<CustomerTagRepository['access']>(),
    listDefinitions: vi.fn<CustomerTagRepository['listDefinitions']>(),
    createDefinition: vi.fn<CustomerTagRepository['createDefinition']>(),
    changeDefinitionStatus: vi.fn<CustomerTagRepository['changeDefinitionStatus']>(),
    attach: vi.fn<CustomerTagRepository['attach']>(),
    detach: vi.fn<CustomerTagRepository['detach']>(),
  };
}

function createTenants(role: 'OWNER' | 'MANAGER' | 'VIEWER' | 'STAFF' | null) {
  return {
    createTenantWithOwner: vi.fn<TenantRepository['createTenantWithOwner']>(),
    findActiveTenantMembership: vi
      .fn<TenantRepository['findActiveTenantMembership']>()
      .mockResolvedValue(
        role === null
          ? null
          : {
              tenant: {
                id: tenantId,
                name: '測試工作室',
                slug: 'test-studio',
                status: 'ACTIVE',
              },
              membership: { role, status: 'ACTIVE' },
            },
      ),
    listMembershipsForUser: vi.fn<TenantRepository['listMembershipsForUser']>(),
    recordAuthorizationDeniedIfTenantExists:
      vi.fn<TenantRepository['recordAuthorizationDeniedIfTenantExists']>(),
  };
}
