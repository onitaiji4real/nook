import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '@nook/config';
import {
  createCustomerNoteRequestSchema,
  type CustomerNote,
  updateCustomerNoteRequestSchema,
} from '@nook/contracts';
import {
  CustomerNoteEncryptionError,
  decryptCustomerNote,
  encryptCustomerNote,
  type CustomerNoteDataKeyWrapper,
  type CustomerNoteEnvelope,
} from '@nook/crypto';
import {
  CustomerNoteRepositoryError,
  type CustomerNoteEnvelopeRecord,
  type CustomerNoteRepository,
  type TenantMembershipRecord,
  type TenantRepository,
} from '@nook/database';
import { createSecurityEventLog, redactValue } from '@nook/observability';

import { RUNTIME_CONFIG } from '../../../platform/config/runtime-config.token';
import { ApplicationError } from '../../../platform/http/application-error';
import { TENANT_REPOSITORY } from '../../../platform/identity/tenant-repository.token';
import { CUSTOMER_NOTE_KEY_WRAPPER, CUSTOMER_NOTE_REPOSITORY } from './customer-notes.tokens';

interface RequestContext {
  readonly tenantId: string;
  readonly customerId: string;
  readonly userId: string;
  readonly requestId: string;
}

type NoteEvent =
  | 'crm.customer_note_created'
  | 'crm.customer_note_updated'
  | 'crm.customer_note_deleted';

@Injectable()
export class CustomerNotesApplicationService {
  constructor(
    @Inject(CUSTOMER_NOTE_REPOSITORY)
    private readonly notes: CustomerNoteRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CUSTOMER_NOTE_KEY_WRAPPER)
    private readonly keyWrapper: CustomerNoteDataKeyWrapper,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
  ) {}

  async readForDetail(input: RequestContext): Promise<readonly CustomerNote[]> {
    await this.requireWriter(input);
    const records = await this.execute(() =>
      this.notes.listEnvelopes({
        tenantId: input.tenantId,
        customerId: input.customerId,
      }),
    );
    if (records.length === 0) return [];
    this.requireActiveFeature();

    const result: CustomerNote[] = [];
    for (const record of records) {
      const content = await this.decrypt(input, record);
      result.push(toContract(record, content));
    }
    return result;
  }

  async create(input: RequestContext & { readonly body: unknown }): Promise<CustomerNote> {
    await this.requireWriter(input);
    this.requireActiveFeature();
    const body = createCustomerNoteRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const noteId = randomUUID();
    const envelope = await this.encrypt(input, noteId, body.data.content);
    const record = await this.execute(() =>
      this.notes.create({
        tenantId: input.tenantId,
        customerId: input.customerId,
        actorUserId: input.userId,
        requestId: input.requestId,
        noteId,
        envelope,
      }),
    );
    this.log('crm.customer_note_created', input);
    return toContract(record, body.data.content);
  }

  async update(
    input: RequestContext & {
      readonly noteId: string;
      readonly body: unknown;
    },
  ): Promise<CustomerNote> {
    await this.requireWriter(input);
    this.requireActiveFeature();
    const body = updateCustomerNoteRequestSchema.safeParse(input.body);
    if (!body.success) throw invalidRequest();
    const envelope = await this.encrypt(input, input.noteId, body.data.content);
    const record = await this.execute(() =>
      this.notes.update({
        tenantId: input.tenantId,
        customerId: input.customerId,
        actorUserId: input.userId,
        requestId: input.requestId,
        noteId: input.noteId,
        expectedUpdatedAt: new Date(body.data.expectedUpdatedAt),
        envelope,
      }),
    );
    this.log('crm.customer_note_updated', input);
    return toContract(record, body.data.content);
  }

  async delete(input: RequestContext & { readonly noteId: string }): Promise<void> {
    await this.requireWriter(input);
    this.requireActiveFeature();
    await this.execute(() =>
      this.notes.delete({
        tenantId: input.tenantId,
        customerId: input.customerId,
        actorUserId: input.userId,
        requestId: input.requestId,
        noteId: input.noteId,
      }),
    );
    this.log('crm.customer_note_deleted', input);
  }

  private async requireWriter(input: RequestContext): Promise<void> {
    let membership: TenantMembershipRecord | null;
    try {
      membership = await this.tenants.findActiveTenantMembership({
        tenantId: input.tenantId,
        userId: input.userId,
      });
    } catch {
      throw notesUnavailable();
    }
    if (
      membership !== null &&
      (membership.membership.role === 'OWNER' || membership.membership.role === 'MANAGER')
    ) {
      return;
    }
    try {
      await this.tenants.recordAuthorizationDeniedIfTenantExists({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        requestId: input.requestId,
      });
    } catch {
      throw notesUnavailable();
    }
    if (membership === null) throw customerNotFound();
    throw new ApplicationError(403, 'tenant_access_denied', 'Forbidden', 'Access is denied.');
  }

  private requireActiveFeature(): void {
    if (this.config.crmNotesMode !== 'active') throw notesUnavailable();
  }

  private async encrypt(
    input: RequestContext,
    noteId: string,
    plaintext: string,
  ): Promise<CustomerNoteEnvelope> {
    try {
      return await encryptCustomerNote({
        plaintext,
        aad: {
          environment: this.config.nodeEnv,
          tenantId: input.tenantId,
          customerId: input.customerId,
          noteId,
          encryptionSchemaVersion: 1,
        },
        keyWrapper: this.keyWrapper,
      });
    } catch (error) {
      if (error instanceof CustomerNoteEncryptionError) throw notesUnavailable();
      throw error;
    }
  }

  private async decrypt(
    input: RequestContext,
    record: CustomerNoteEnvelopeRecord,
  ): Promise<string> {
    if (record.encryptionSchemaVersion !== 1) throw notesUnavailable();
    try {
      return await decryptCustomerNote({
        envelope: {
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          authTag: record.authTag,
          wrappedDek: record.wrappedDek,
          kekResourceVersion: record.kekResourceVersion,
          encryptionSchemaVersion: record.encryptionSchemaVersion,
        },
        aad: {
          environment: this.config.nodeEnv,
          tenantId: input.tenantId,
          customerId: input.customerId,
          noteId: record.id,
          encryptionSchemaVersion: 1,
        },
        keyWrapper: this.keyWrapper,
      });
    } catch (error) {
      if (error instanceof CustomerNoteEncryptionError) throw notesUnavailable();
      throw error;
    }
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  private log(event: NoteEvent, input: RequestContext): void {
    process.stdout.write(
      `${JSON.stringify(
        redactValue(
          createSecurityEventLog({
            event,
            requestId: input.requestId,
            actorUserId: input.userId,
            tenantId: input.tenantId,
            outcome: 'success',
            version: this.config.appVersion,
            environment: this.config.nodeEnv,
          }),
        ),
      )}\n`,
    );
  }
}

function toContract(record: CustomerNoteEnvelopeRecord, content: string): CustomerNote {
  return {
    id: record.id,
    content,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof CustomerNoteRepositoryError)) return notesUnavailable();
  const mapping = {
    customer_not_found: [404, 'customer_not_found', 'Not Found', 'The customer was not found.'],
    note_not_found: [404, 'customer_note_not_found', 'Not Found', 'The note was not found.'],
    note_limit_reached: [
      409,
      'customer_note_limit_reached',
      'Conflict',
      'The customer note limit has been reached.',
    ],
    note_conflict: [409, 'customer_note_conflict', 'Conflict', 'The customer note has changed.'],
    note_unavailable: [
      503,
      'customer_notes_unavailable',
      'Service Unavailable',
      'Customer notes are temporarily unavailable.',
    ],
  } as const;
  const [status, code, title, detail] = mapping[error.code];
  return new ApplicationError(status, code, title, detail);
}

function invalidRequest(): ApplicationError {
  return new ApplicationError(400, 'invalid_request', 'Bad Request', 'The request is invalid.');
}

function customerNotFound(): ApplicationError {
  return new ApplicationError(
    404,
    'customer_not_found',
    'Not Found',
    'The customer was not found.',
  );
}

function notesUnavailable(): ApplicationError {
  return new ApplicationError(
    503,
    'customer_notes_unavailable',
    'Service Unavailable',
    'Customer notes are temporarily unavailable.',
  );
}
