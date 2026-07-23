import { z } from 'zod';

export const merchantSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const merchantVisibilityRequestSchema = z
  .object({ visibilityStatus: z.enum(['DRAFT', 'PUBLISHED']) })
  .strict();

export const portfolioPublicationRequestSchema = z
  .object({ status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']) })
  .strict();

export type PublicationReadinessCode =
  | 'PROFILE_CONTENT'
  | 'ACTIVE_LOCATION'
  | 'ACTIVE_SERVICE'
  | 'ACTIVE_STAFF'
  | 'WEEKLY_AVAILABILITY'
  | 'PUBLISHED_PORTFOLIO';

export interface PublicationReadinessItem {
  readonly code: PublicationReadinessCode;
  readonly label: string;
  readonly ready: boolean;
  readonly actionPath: string;
}

export interface MerchantPublicationResponse {
  readonly tenantId: string;
  readonly slug: string;
  readonly visibilityStatus: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
  readonly verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  readonly publishedAt: string | null;
  readonly publicPath: string;
  readonly readyToPublish: boolean;
  readonly readiness: readonly PublicationReadinessItem[];
}

export interface PublicMerchantResponse {
  readonly slug: string;
  readonly name: string;
  readonly category: 'NAIL' | 'LASH' | 'BROW' | 'BEAUTY' | 'HAIR' | 'OTHER';
  readonly description: string;
  readonly verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
  readonly publishedAt: string;
  readonly contact: {
    readonly lineOaUrl: string | null;
    readonly instagramUrl: string | null;
  };
  readonly location: {
    readonly disclosure: 'FULL' | 'DISTRICT_ONLY';
    readonly name: string | null;
    readonly address: string | null;
    readonly postalCode: string | null;
    readonly city: string;
    readonly district: string;
    readonly timezone: 'Asia/Taipei';
  };
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly durationMinutes: number;
    readonly priceType: 'FIXED' | 'FROM' | 'RANGE' | 'QUOTE';
    readonly priceAmount: number | null;
    readonly priceMin: number | null;
    readonly priceMax: number | null;
    readonly currency: 'TWD';
  }[];
  readonly staff: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly bio: string | null;
    readonly serviceIds: readonly string[];
  }[];
  readonly weeklyHours: readonly {
    readonly weekday: number;
    readonly startTime: string;
    readonly endTime: string;
  }[];
  readonly portfolio: readonly {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    readonly tags: readonly string[];
    readonly imageUrl: string;
    readonly thumbnailUrl: string;
  }[];
  readonly policies: {
    readonly booking: string;
    readonly cancellation: string;
  };
  readonly bookingAvailability: 'CANDIDATE_SLOTS';
}

export type MerchantVisibilityRequest = z.infer<typeof merchantVisibilityRequestSchema>;
export type PortfolioPublicationRequest = z.infer<typeof portfolioPublicationRequestSchema>;
