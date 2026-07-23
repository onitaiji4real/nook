import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaLineWebhookRepository } from '../src';

const prisma = new PrismaClient();
const repository = new PrismaLineWebhookRepository(prisma);
const displayNamePrefix = 'LINE webhook repository ';

describe('LINE webhook repository', () => {
  beforeEach(clearFixtures);
  afterAll(async () => {
    await clearFixtures();
    await prisma.$disconnect();
  });

  it('records each event once and applies same-timestamp unfollow with precedence', async () => {
    const fixture = await createIdentity('ordering');
    const observedAt = new Date('2026-07-23T01:00:00.000Z');
    const follow = input(fixture.providerSubject, 'follow', observedAt, 'event-follow');
    const unfollow = input(fixture.providerSubject, 'unfollow', observedAt, 'event-unfollow');

    await expect(repository.record(follow)).resolves.toEqual({
      replayed: false,
      status: 'PROCESSED',
    });
    await expect(repository.record(unfollow)).resolves.toEqual({
      replayed: false,
      status: 'PROCESSED',
    });
    await expect(repository.record(follow)).resolves.toEqual({
      replayed: true,
      status: 'PROCESSED',
    });
    await expect(
      prisma.lineMessagingRecipient.findUniqueOrThrow({
        where: { providerSubject: fixture.providerSubject },
      }),
    ).resolves.toMatchObject({
      userId: fixture.userId,
      status: 'BLOCKED',
      observedAt,
      observedWebhookEventId: 'event-unfollow',
    });
    await expect(prisma.lineWebhookEvent.count()).resolves.toBe(2);
  });

  it('retains unknown events as ignored and deletes only expired raw evidence', async () => {
    const fixture = await createIdentity('retention');
    await expect(
      repository.record({
        webhookEventId: 'event-unknown',
        eventType: 'message',
        routedType: 'other',
        sourceType: 'user',
        providerSubject: fixture.providerSubject,
        providerTimestamp: new Date(),
        payloadJson: { webhookEventId: 'event-unknown', type: 'message' },
      }),
    ).resolves.toEqual({ replayed: false, status: 'IGNORED' });

    await prisma.lineWebhookEvent.update({
      where: { webhookEventId: 'event-unknown' },
      data: {
        receivedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
        processedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
      },
    });
    await expect(repository.deleteExpired({ limit: 1_000 })).resolves.toBe(1);
    await expect(prisma.lineWebhookEvent.count()).resolves.toBe(0);
    await expect(
      prisma.lineMessagingRecipient.findUnique({
        where: { providerSubject: fixture.providerSubject },
      }),
    ).resolves.toBeNull();
  });

  it('rejects linking one provider subject to a different local user', async () => {
    const fixture = await createIdentity('mismatch');
    const other = await prisma.user.create({
      data: { displayName: `${displayNamePrefix}other mismatch` },
    });
    await prisma.lineMessagingRecipient.create({
      data: {
        providerSubject: fixture.providerSubject,
        userId: other.id,
        status: 'FOLLOWING',
        observedAt: new Date('2026-07-23T00:00:00.000Z'),
        observedWebhookEventId: 'prior-event',
      },
    });

    await expect(
      repository.record(
        input(
          fixture.providerSubject,
          'follow',
          new Date('2026-07-23T01:00:00.000Z'),
          'mismatch-event',
        ),
      ),
    ).rejects.toThrowError('line_recipient_identity_mismatch');
    await expect(
      prisma.lineWebhookEvent.findUnique({ where: { webhookEventId: 'mismatch-event' } }),
    ).resolves.toBeNull();
  });
});

function input(
  providerSubject: string,
  routedType: 'follow' | 'unfollow',
  providerTimestamp: Date,
  webhookEventId: string,
) {
  return {
    webhookEventId,
    eventType: routedType,
    routedType,
    sourceType: 'user' as const,
    providerSubject,
    providerTimestamp,
    payloadJson: { webhookEventId, type: routedType },
  };
}

async function createIdentity(suffix: string): Promise<{
  readonly userId: string;
  readonly providerSubject: string;
}> {
  const user = await prisma.user.create({
    data: { displayName: `${displayNamePrefix}${suffix}` },
  });
  const providerSubject = `U${randomUUID().replaceAll('-', '')}`;
  await prisma.userIdentity.create({
    data: { userId: user.id, provider: 'LINE', providerSubject },
  });
  return { userId: user.id, providerSubject };
}

async function clearFixtures(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { displayName: { startsWith: displayNamePrefix } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length > 0) {
    await prisma.lineMessagingRecipient.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.lineWebhookEvent.deleteMany({
    where: { webhookEventId: { startsWith: 'event-' } },
  });
}
