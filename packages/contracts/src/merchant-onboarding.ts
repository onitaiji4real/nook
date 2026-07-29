import { z } from 'zod';

const optionalText = (maxLength: number) => z.string().trim().min(1).max(maxLength).optional();
const money = z.number().int().min(0).max(10_000_000);

function hasAllowedHost(rawUrl: string, hosts: readonly string[]): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const lineOaUrl = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => hasAllowedHost(value, ['lin.ee', 'line.me', 'page.line.me']),
    'LINE OA URL must use an approved LINE host.',
  )
  .optional();

const instagramUrl = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => hasAllowedHost(value, ['instagram.com', 'www.instagram.com']),
    'Instagram URL must use instagram.com.',
  )
  .optional();

export const servicePriceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FIXED'), amount: money }).strict(),
  z.object({ type: z.literal('FROM'), amount: money }).strict(),
  z
    .object({ type: z.literal('RANGE'), min: money, max: money })
    .strict()
    .refine((price) => price.min <= price.max, { message: 'Price range is invalid.' }),
  z.object({ type: z.literal('QUOTE') }).strict(),
]);

export const merchantOnboardingRequestSchema = z
  .object({
    profile: z
      .object({
        category: z.enum(['NAIL', 'LASH', 'BROW', 'BEAUTY', 'HAIR', 'OTHER']),
        description: optionalText(2000),
        phone: z
          .string()
          .trim()
          .min(8)
          .max(24)
          .regex(/^\+?[0-9][0-9 ()-]+$/)
          .optional(),
        lineOaUrl,
        instagramUrl,
        bookingPolicy: optionalText(2000),
        cancellationPolicy: optionalText(2000),
      })
      .strict(),
    location: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        addressText: z.string().trim().min(1).max(500),
        postalCode: z.string().trim().min(3).max(10).optional(),
        city: z.string().trim().min(1).max(80),
        district: z.string().trim().min(1).max(80),
        isPublicAddress: z.boolean().default(false),
      })
      .strict(),
    service: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(160),
        description: optionalText(2000),
        durationMinutes: z.number().int().min(5).max(720),
        bufferBeforeMinutes: z.number().int().min(0).max(180).default(0),
        bufferAfterMinutes: z.number().int().min(0).max(180).default(0),
        price: servicePriceSchema,
        bookingEnabled: z.boolean().default(true),
      })
      .strict(),
  })
  .strict();

export type MerchantOnboardingRequest = z.infer<typeof merchantOnboardingRequestSchema>;

export interface MerchantOnboardingResponse {
  readonly tenantId: string;
  readonly profile: {
    readonly category: MerchantOnboardingRequest['profile']['category'];
    readonly description: string | null;
    readonly phone: string | null;
    readonly lineOaUrl: string | null;
    readonly instagramUrl: string | null;
    readonly bookingPolicy: string | null;
    readonly cancellationPolicy: string | null;
    readonly visibilityStatus: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
    readonly verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  };
  readonly primaryLocation: {
    readonly id: string;
    readonly name: string;
    readonly addressText: string;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
    readonly timezone: 'Asia/Taipei';
    readonly isPublicAddress: boolean;
    readonly status: 'ACTIVE' | 'INACTIVE';
  };
  readonly starterService: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly durationMinutes: number;
    readonly bufferBeforeMinutes: number;
    readonly bufferAfterMinutes: number;
    readonly price: MerchantOnboardingRequest['service']['price'];
    readonly currency: 'TWD';
    readonly bookingEnabled: boolean;
    readonly status: 'ACTIVE' | 'INACTIVE';
  };
  readonly readiness: {
    readonly completedSteps: readonly ['PROFILE', 'LOCATION', 'SERVICE'];
    readonly readyForSchedule: true;
    readonly readyToPublish: false;
  };
}
