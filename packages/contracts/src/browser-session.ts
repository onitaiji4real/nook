import { z } from 'zod';

const firebaseBrowserConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    authDomain: z.string().min(1),
    projectId: z.string().min(1),
    appId: z.string().min(1),
    messagingSenderId: z.string().min(1),
  })
  .strict();

const browserCapabilitiesSchema = z
  .object({
    bookingPolicyV2Writes: z.boolean(),
    appointmentLifecycle: z.boolean(),
    customerNotes: z.boolean(),
  })
  .strict();

export const browserRuntimeConfigResponseSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('disabled'),
      apiBaseUrl: z.string().url(),
      capabilities: browserCapabilitiesSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal('firebase-line'),
      apiBaseUrl: z.string().url(),
      capabilities: browserCapabilitiesSchema,
      liffId: z.string().min(1),
      merchantLiffId: z.string().min(1),
      firebase: firebaseBrowserConfigSchema,
    })
    .strict(),
]);

export type BrowserRuntimeConfigResponse = z.infer<typeof browserRuntimeConfigResponseSchema>;
