import { IdentityProvider, Prisma, type PrismaClient } from '@prisma/client';

export interface LinkLineIdentityInput {
  readonly subject: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
}

export interface IdentityRepository {
  findOrCreateLineIdentity(input: LinkLineIdentityInput): Promise<{ readonly userId: string }>;
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
