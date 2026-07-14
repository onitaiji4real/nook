export type EntityId = string;

export interface DomainEvent<TPayload extends object = Record<string, never>> {
  readonly name: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
