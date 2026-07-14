import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  prismaClient ??= new PrismaClient();
  return prismaClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (prismaClient !== undefined) {
    await prismaClient.$disconnect();
    prismaClient = undefined;
  }
}

export async function checkDatabaseConnection(client = getPrismaClient()): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export { Prisma, PrismaClient } from '@prisma/client';
export {
  PrismaIdentityRepository,
  type IdentityRepository,
  type LinkLineIdentityInput,
} from './identity-repository';
export {
  classifyTenantConflict,
  PrismaTenantRepository,
  type CreateTenantWithOwnerInput,
  type TenantConflictCode,
  type TenantMembershipRecord,
  type TenantRepository,
  type UserMembershipRecord,
} from './tenant-repository';
