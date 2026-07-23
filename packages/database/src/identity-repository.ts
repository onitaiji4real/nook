import { IdentityProvider, Prisma, UserStatus, type PrismaClient } from '@prisma/client';

export interface LinkLineIdentityInput {
  readonly subject: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export interface IdentityRepository {
  findOrCreateLineIdentity(input: LinkLineIdentityInput): Promise<{ readonly userId: string }>;
  linkLineMessagingRecipient(input: {
    readonly subject: string;
    readonly userId: string;
  }): Promise<void>;
  isActiveUser(userId: string): Promise<boolean>;
}

export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreateLineIdentity(
    input: LinkLineIdentityInput,
  ): Promise<{ readonly userId: string }> {
    const existing = await this.find(input.subject);
    if (existing !== null) return existing;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            displayName: input.displayName ?? 'LINE 使用者',
            ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
          },
          select: { id: true },
        });
        await transaction.userIdentity.create({
          data: {
            userId: user.id,
            provider: IdentityProvider.LINE,
            providerSubject: input.subject,
            profileJson: {
              ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
              ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
            },
          },
        });
        return { userId: user.id };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrent = await this.find(input.subject);
      if (concurrent !== null) return concurrent;
      throw error;
    }
  }

  async isActiveUser(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    return user !== null;
  }

  async linkLineMessagingRecipient(input: {
    readonly subject: string;
    readonly userId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const users = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "users" WHERE "id" = ${input.userId}::uuid FOR UPDATE
      `);
      const identities = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "user_identities"
        WHERE "user_id" = ${input.userId}::uuid
          AND "provider" = 'LINE'::"IdentityProvider"
          AND "provider_subject" = ${input.subject}
        FOR UPDATE
      `);
      if (users.length !== 1 || identities.length !== 1) throw new Error('line_identity_corrupt');
      await tx.$queryRaw<Array<{ provider_subject: string }>>(Prisma.sql`
        SELECT "provider_subject"
        FROM "line_messaging_recipients"
        WHERE "provider_subject" = ${input.subject}
        FOR UPDATE
      `);
      const recipient = await tx.lineMessagingRecipient.findUnique({
        where: { providerSubject: input.subject },
        select: { userId: true },
      });
      if (recipient === null) return;
      if (recipient.userId !== null && recipient.userId !== input.userId) {
        throw new Error('line_recipient_identity_mismatch');
      }
      if (recipient.userId === null) {
        await tx.lineMessagingRecipient.update({
          where: { providerSubject: input.subject },
          data: { userId: input.userId },
        });
      }
    });
  }

  private find(subject: string): Promise<{ readonly userId: string } | null> {
    return this.prisma.userIdentity.findUnique({
      where: {
        provider_providerSubject: { provider: IdentityProvider.LINE, providerSubject: subject },
      },
      select: { userId: true },
    });
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
