import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('API modular architecture', () => {
  it('keeps the source root limited to bootstrap and composition', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const rootTypescriptFiles = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => entry.name)
      .sort();

    expect(rootTypescriptFiles).toEqual(['app.module.ts', 'main.ts']);

    const appModule = readFileSync(resolve(sourceRoot, 'app.module.ts'), 'utf8');
    expect(appModule).not.toMatch(/\bcontrollers\s*:/);
    expect(appModule).not.toMatch(/\bproviders\s*:/);
  });

  it('keeps each non-empty business feature behind one Nest module', () => {
    const modulesRoot = resolve(process.cwd(), 'src/modules');
    const featureDirectories = readdirSync(modulesRoot, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );

    for (const featureDirectory of featureDirectories) {
      const typescriptFiles = readdirSync(resolve(modulesRoot, featureDirectory.name), {
        withFileTypes: true,
      }).filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));

      if (typescriptFiles.length === 0) {
        continue;
      }

      const moduleFiles = typescriptFiles.filter((entry) => entry.name.endsWith('.module.ts'));
      expect(moduleFiles, featureDirectory.name).toHaveLength(1);
      expect(typescriptFiles.length, featureDirectory.name).toBeLessThanOrEqual(12);
    }
  });

  it('keeps Prisma out of HTTP controllers', () => {
    for (const filename of [
      'modules/tenancy/tenant.controller.ts',
      'modules/line-auth/line-auth.controller.ts',
      'modules/line-studio-entry/line-studio-entry.controller.ts',
      'modules/line-webhook/line-webhook.controller.ts',
      'modules/merchant-onboarding/merchant-onboarding.controller.ts',
      'modules/service-catalog/service-catalog.controller.ts',
      'modules/scheduling/staff-scheduling.controller.ts',
      'modules/portfolio/portfolio.controller.ts',
      'modules/publication/merchant-publication.controller.ts',
      'modules/booking/booking-hold.controller.ts',
      'modules/booking/booking-policy.controller.ts',
      'modules/appointments/appointment.controller.ts',
      'modules/appointments/appointment-view.controller.ts',
      'modules/appointments/appointment-lifecycle.controller.ts',
    ]) {
      const controller = readFileSync(resolve(process.cwd(), `src/${filename}`), 'utf8');
      expect(controller).not.toContain('@prisma/client');
      expect(controller).not.toMatch(/\bPrisma(?:Client)?\b/);
    }
  });

  it('keeps appointment confirmation transactional, generic, and controller-separated', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/appointment-confirmation-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/appointments/appointment-application.service.ts'),
      'utf8',
    );
    expect(repository).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(repository).toContain("entitlementCode: 'MAX_MONTHLY_BOOKINGS'");
    expect(repository).toContain('holdId: null, appointmentId: appointment.id');
    expect(repository).not.toMatch(/plan\.(?:code|name)|FREE_EXPOSURE/);
    expect(application).toContain('appointmentConfirmationEnabled');
    expect(application).not.toMatch(/bookingPolicy.*console|address.*console/i);
  });

  it('keeps appointment views owner-scoped, tenant-scoped, and response-allowlisted', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/appointment-view-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/appointments/appointment-view-application.service.ts'),
      'utf8',
    );
    const controller = readFileSync(
      resolve(process.cwd(), 'src/modules/appointments/appointment-view.controller.ts'),
      'utf8',
    );

    expect(repository).toContain('consumerUserId: input.consumerUserId');
    expect(repository).toContain('tenantId: input.tenantId');
    expect(repository).toContain('transaction_timestamp()');
    expect(repository).toContain('staffDisplayNameSnapshot');
    expect(application).toContain("membership.membership.role !== 'STAFF'");
    expect(application).toContain('resolveActiveStaffId');
    expect(controller.match(/private, no-store/g)).toHaveLength(4);
    expect(application).not.toMatch(/phone|email|addressText.*merchant|customerNote/i);
  });

  it('keeps public merchant output allowlisted and private address masking server-side', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/merchant-publication-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/publication/merchant-publication-application.service.ts'),
      'utf8',
    );
    expect(repository).toContain("visibilityStatus: 'PUBLISHED'");
    expect(repository).toContain("status: 'PUBLISHED', mediaAsset: { is: { status: 'READY' } }");
    expect(repository).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(repository).toContain('where: { tenantId: input.tenantId');
    expect(application).toContain("disclosure: 'DISTRICT_ONLY'");
    expect(application).toContain('address: null');
    expect(application).toContain('postalCode: null');
    expect(application).not.toMatch(/plan\.(?:code|name)|FREE_EXPOSURE/);
  });

  it('keeps scheduling in a feature module with generic authorization and entitlements', () => {
    const appModule = readFileSync(resolve(process.cwd(), 'src/app.module.ts'), 'utf8');
    const module = readFileSync(
      resolve(process.cwd(), 'src/modules/scheduling/scheduling.module.ts'),
      'utf8',
    );
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/staff-scheduling-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/scheduling/staff-scheduling-application.service.ts'),
      'utf8',
    );

    expect(appModule).toContain('SchedulingModule');
    expect(module).toContain('controllers: [StaffSchedulingController]');
    expect(repository).toContain("const maxStaffEntitlement = 'MAX_STAFF'");
    expect(repository).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(repository).toContain('where: { tenantId: input.tenantId');
    expect(application).toContain("['OWNER', 'MANAGER']");
    expect(application).not.toMatch(/plan\.(?:code|name)|FREE_EXPOSURE/);
  });

  it('keeps portfolio upload bounded, tenant-scoped, and outside API image proxying', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/portfolio-media-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/portfolio/portfolio-application.service.ts'),
      'utf8',
    );
    const gateways = readFileSync(
      resolve(process.cwd(), 'src/modules/portfolio/media-gateways.ts'),
      'utf8',
    );
    const controller = readFileSync(
      resolve(process.cwd(), 'src/modules/portfolio/portfolio.controller.ts'),
      'utf8',
    );

    expect(repository).toContain("const entitlementCode = 'MAX_PORTFOLIO_IMAGES'");
    expect(repository).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(repository).toContain('where: { tenantId: input.tenantId');
    expect(application).toContain("['OWNER', 'MANAGER', 'STAFF']");
    expect(application).toContain('tenants/${tenantId}/portfolio/${mediaAssetId}/upload');
    expect(application).not.toMatch(/plan\.(?:code|name)|FREE_EXPOSURE/);
    expect(gateways).toContain("['content-length-range', 1, 15 * 1024 * 1024]");
    expect(gateways).toContain('oidcToken');
    expect(controller).not.toMatch(/FileInterceptor|UploadedFile|multer/i);
  });

  it('keeps service catalog authorization and entitlement enforcement generic', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/service-catalog-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(process.cwd(), 'src/modules/service-catalog/service-catalog-application.service.ts'),
      'utf8',
    );

    expect(repository).toContain('Prisma.TransactionIsolationLevel.Serializable');
    expect(repository).toContain("const maxServicesEntitlement = 'MAX_SERVICES'");
    expect(repository).toContain('where: { tenantId: input.tenantId');
    expect(repository).not.toContain('FREE_EXPOSURE');
    expect(application).toContain("['OWNER', 'MANAGER']");
    expect(application).not.toMatch(/plan\.(?:code|name)|FREE_EXPOSURE/);
    const securityLogPayloads = [
      ...application.matchAll(/createSecurityEventLog\(\{([\s\S]*?)\}\)/g),
    ];
    expect(securityLogPayloads.length).toBeGreaterThan(0);
    for (const payload of securityLogPayloads) {
      expect(payload[1]).not.toMatch(/name|description|price|body/);
    }
  });

  it('keeps merchant onboarding writes tenant-scoped and transactional', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/merchant-onboarding-repository.ts'),
      'utf8',
    );
    const application = readFileSync(
      resolve(
        process.cwd(),
        'src/modules/merchant-onboarding/merchant-onboarding-application.service.ts',
      ),
      'utf8',
    );

    expect(repository).toContain('this.prisma.$transaction');
    expect(repository).toContain('tenantId_id: { tenantId: input.tenantId');
    expect(repository).toContain("action: 'merchant.onboarding.saved'");
    expect(application).toContain("membership.membership.role !== 'OWNER'");
    const securityLogPayloads = [
      ...application.matchAll(/this\.writeSecurityEvent\(\{([\s\S]*?)\}\);/g),
    ];
    expect(securityLogPayloads.length).toBeGreaterThan(0);
    for (const payload of securityLogPayloads) {
      expect(payload[1]).not.toMatch(/phone|addressText|description|lineOaUrl|instagramUrl/);
    }
  });

  it('uses explicit injection for health dependencies in tsx development', () => {
    for (const app of ['api', 'worker']) {
      const sourceRoot = resolve(process.cwd(), `../../apps/${app}/src`);
      const healthRoot = app === 'api' ? resolve(sourceRoot, 'modules/health') : sourceRoot;
      const controller = readFileSync(resolve(healthRoot, 'health.controller.ts'), 'utf8');
      const service = readFileSync(resolve(healthRoot, 'health.service.ts'), 'utf8');

      expect(controller).toContain('@Inject(HealthService)');
      expect(service).toContain('@Inject(DatabaseProbeService)');
    }
  });

  it('requires tenantId in tenant-owned repository methods', () => {
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/tenant-repository.ts'),
      'utf8',
    );
    expect(repository).toMatch(/findActiveTenantMembership\(input: \{[\s\S]*?tenantId: string/);
    expect(repository).toMatch(
      /recordAuthorizationDeniedIfTenantExists\(input: \{[\s\S]*?tenantId: string/,
    );
  });

  it('keeps LINE rate limiting cross-instance and free of trusted client-header assumptions', () => {
    const limiter = readFileSync(
      resolve(process.cwd(), 'src/modules/line-auth/line-auth-rate-limit.service.ts'),
      'utf8',
    );
    const repository = readFileSync(
      resolve(process.cwd(), '../../packages/database/src/rate-limit-repository.ts'),
      'utf8',
    );

    expect(limiter).toContain("createHash('sha256')");
    expect(limiter).not.toMatch(/x-forwarded-for|x-real-ip/i);
    expect(repository).toContain('ON CONFLICT');
    expect(repository).toContain('"request_count" + 1');
  });
});
