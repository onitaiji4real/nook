import { Prisma, type PrismaClient } from '@prisma/client';

export const CUSTOMER_NOTE_LIMIT = 100;

export interface CustomerNoteEnvelopeRecord {
  readonly id: string;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly kekResourceVersion: string;
  readonly encryptionSchemaVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomerNoteEnvelopeInput {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly authTag: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly kekResourceVersion: string;
  readonly encryptionSchemaVersion: number;
}

export interface CustomerNoteMutationContext {
  readonly tenantId: string;
  readonly customerId: string;
  readonly actorUserId: string;
  readonly requestId: string;
}

export type CustomerNoteRepositoryErrorCode =
  | 'customer_not_found'
  | 'note_not_found'
  | 'note_limit_reached'
  | 'note_conflict'
  | 'note_unavailable';

export class CustomerNoteRepositoryError extends Error {
  constructor(readonly code: CustomerNoteRepositoryErrorCode) {
    super(code);
    this.name = 'CustomerNoteRepositoryError';
  }
}

export interface CustomerNoteRepository {
  listEnvelopes(input: {
    readonly tenantId: string;
    readonly customerId: string;
  }): Promise<readonly CustomerNoteEnvelopeRecord[]>;
  create(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
      readonly envelope: CustomerNoteEnvelopeInput;
    },
  ): Promise<CustomerNoteEnvelopeRecord>;
  update(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
      readonly expectedUpdatedAt: Date;
      readonly envelope: CustomerNoteEnvelopeInput;
    },
  ): Promise<CustomerNoteEnvelopeRecord>;
  delete(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
    },
  ): Promise<void>;
}

type TransactionClient = Prisma.TransactionClient;

const noteSelect = {
  id: true,
  ciphertext: true,
  nonce: true,
  authTag: true,
  wrappedDek: true,
  kekResourceVersion: true,
  encryptionSchemaVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaCustomerNoteRepository implements CustomerNoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listEnvelopes(input: {
    readonly tenantId: string;
    readonly customerId: string;
  }): Promise<readonly CustomerNoteEnvelopeRecord[]> {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { tenantId: input.tenantId, id: input.customerId },
        select: { id: true },
      });
      if (customer === null) throw new CustomerNoteRepositoryError('customer_not_found');
      const notes = await this.prisma.customerNote.findMany({
        where: { tenantId: input.tenantId, customerId: input.customerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CUSTOMER_NOTE_LIMIT + 1,
        select: noteSelect,
      });
      if (notes.length > CUSTOMER_NOTE_LIMIT) {
        throw new CustomerNoteRepositoryError('note_unavailable');
      }
      return notes;
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
  }

  create(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
      readonly envelope: CustomerNoteEnvelopeInput;
    },
  ): Promise<CustomerNoteEnvelopeRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await lockCustomer(transaction, input.tenantId, input.customerId);
      const membershipId = await requireNoteWriter(transaction, input);
      const count = await transaction.customerNote.count({
        where: { tenantId: input.tenantId, customerId: input.customerId },
      });
      if (count >= CUSTOMER_NOTE_LIMIT) {
        throw new CustomerNoteRepositoryError('note_limit_reached');
      }
      const note = await transaction.customerNote.create({
        data: {
          id: input.noteId,
          tenantId: input.tenantId,
          customerId: input.customerId,
          ...toPrismaEnvelope(input.envelope),
          createdByMembershipId: membershipId,
        },
        select: noteSelect,
      });
      await writeNoteAudit(transaction, input, 'crm.customer_note_created', input.noteId);
      return note;
    });
  }

  update(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
      readonly expectedUpdatedAt: Date;
      readonly envelope: CustomerNoteEnvelopeInput;
    },
  ): Promise<CustomerNoteEnvelopeRecord> {
    return this.withSerializableRetry(async (transaction) => {
      await lockCustomer(transaction, input.tenantId, input.customerId);
      await requireNoteWriter(transaction, input);
      const current = await lockNote(transaction, input.tenantId, input.customerId, input.noteId);
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        throw new CustomerNoteRepositoryError('note_conflict');
      }
      const note = await transaction.customerNote.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.noteId,
          },
        },
        data: toPrismaEnvelope(input.envelope),
        select: noteSelect,
      });
      await writeNoteAudit(transaction, input, 'crm.customer_note_updated', input.noteId);
      return note;
    });
  }

  delete(
    input: CustomerNoteMutationContext & {
      readonly noteId: string;
    },
  ): Promise<void> {
    return this.withSerializableRetry(async (transaction) => {
      await lockCustomer(transaction, input.tenantId, input.customerId);
      await requireNoteWriter(transaction, input);
      await lockNote(transaction, input.tenantId, input.customerId, input.noteId);
      await transaction.customerNote.delete({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.noteId,
          },
        },
      });
      await writeNoteAudit(transaction, input, 'crm.customer_note_deleted', input.noteId);
    });
  }

  private async withSerializableRetry<T>(
    operation: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (error instanceof CustomerNoteRepositoryError) throw error;
        if (attempt < 3 && isRetryableTransactionError(error)) continue;
        throw normalizeRepositoryError(error);
      }
    }
    throw new CustomerNoteRepositoryError('note_unavailable');
  }
}

async function lockCustomer(
  transaction: TransactionClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id"
    FROM "customers"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "id" = ${customerId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new CustomerNoteRepositoryError('customer_not_found');
}

async function lockNote(
  transaction: TransactionClient,
  tenantId: string,
  customerId: string,
  noteId: string,
): Promise<{ readonly id: string; readonly updatedAt: Date }> {
  const rows = await transaction.$queryRaw<readonly { id: string; updatedAt: Date }[]>`
    SELECT "id", "updated_at" AS "updatedAt"
    FROM "customer_notes"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "customer_id" = ${customerId}::uuid
      AND "id" = ${noteId}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) throw new CustomerNoteRepositoryError('note_not_found');
  return row;
}

async function requireNoteWriter(
  transaction: TransactionClient,
  input: CustomerNoteMutationContext,
): Promise<string> {
  const membership = await transaction.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      role: { in: ['OWNER', 'MANAGER'] },
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
      user: { status: 'ACTIVE' },
    },
    select: { id: true },
  });
  if (membership === null) throw new CustomerNoteRepositoryError('note_unavailable');
  return membership.id;
}

function toPrismaEnvelope(envelope: CustomerNoteEnvelopeInput) {
  return {
    ciphertext: Uint8Array.from(envelope.ciphertext),
    nonce: Uint8Array.from(envelope.nonce),
    authTag: Uint8Array.from(envelope.authTag),
    wrappedDek: Uint8Array.from(envelope.wrappedDek),
    kekResourceVersion: envelope.kekResourceVersion,
    encryptionSchemaVersion: envelope.encryptionSchemaVersion,
  };
}

function writeNoteAudit(
  transaction: TransactionClient,
  input: CustomerNoteMutationContext,
  action: 'crm.customer_note_created' | 'crm.customer_note_updated' | 'crm.customer_note_deleted',
  noteId: string,
): Promise<unknown> {
  return transaction.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action,
      resourceType: 'customer_note',
      resourceId: noteId,
      requestId: input.requestId,
    },
  });
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  const message = error instanceof Error ? error.message : '';
  return (
    /\b40001\b/.test(message) ||
    /\b40P01\b/.test(message) ||
    /could not serialize access|deadlock detected/i.test(message)
  );
}

function normalizeRepositoryError(error: unknown): CustomerNoteRepositoryError {
  return error instanceof CustomerNoteRepositoryError
    ? error
    : new CustomerNoteRepositoryError('note_unavailable');
}
