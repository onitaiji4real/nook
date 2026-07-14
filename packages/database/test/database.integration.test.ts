import { IdentityProvider, PrismaClient, UserStatus } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const prisma = new PrismaClient();

describe('database foundation', () => {
  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.userIdentity.deleteMany();
    await prisma.tenant.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads the PostGIS extension', async () => {
    const result = await prisma.$queryRaw<
      Array<{ version: string }>
    >`SELECT PostGIS_Version() AS version`;

    expect(result[0]?.version).toMatch(/^3\./);
  });

  it('enforces unique provider identities', async () => {
    const user = await prisma.user.create({
      data: {
        displayName: 'Synthetic Test User',
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: IdentityProvider.LINE,
        providerSubject: 'synthetic-line-subject',
      },
    });

    await expect(
      prisma.userIdentity.create({
        data: {
          userId: user.id,
          provider: IdentityProvider.LINE,
          providerSubject: 'synthetic-line-subject',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('enforces one membership per user and tenant', async () => {
    const [user, tenant] = await Promise.all([
      prisma.user.create({ data: { displayName: 'Synthetic Owner' } }),
      prisma.tenant.create({ data: { name: 'Synthetic Studio', slug: 'synthetic-studio' } }),
    ]);

    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' },
    });

    await expect(
      prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'STAFF' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
