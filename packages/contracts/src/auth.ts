import { z } from 'zod';

export const lineExchangeRequestSchema = z
  .object({
    idToken: z.string().min(1).max(8_192),
    nonce: z.string().min(16).max(256),
  })
  .strict();

export type LineExchangeRequest = z.infer<typeof lineExchangeRequestSchema>;

export interface LineExchangeResponse {
  readonly customToken: string;
  readonly expiresIn: number;
}
