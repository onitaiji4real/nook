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
export {
  isMerchantOnboardingResourceConflict,
  PrismaMerchantOnboardingRepository,
  type MerchantOnboardingRecord,
  type MerchantOnboardingRepository,
  type SaveMerchantOnboardingInput,
} from './merchant-onboarding-repository';
export {
  PrismaRateLimitRepository,
  type ConsumeRateLimitInput,
  type RateLimitDecision,
  type RateLimitRepository,
} from './rate-limit-repository';
export {
  PrismaServiceCatalogRepository,
  ServiceCatalogRepositoryError,
  type ChangeCatalogServiceStatusInput,
  type CreateCatalogServiceInput,
  type ReorderCatalogServicesInput,
  type ServiceCatalogConflictCode,
  type ServiceCatalogRecord,
  type ServiceCatalogRecordItem,
  type ServiceCatalogRepository,
  type UpdateCatalogServiceInput,
} from './service-catalog-repository';
export {
  PrismaStaffSchedulingRepository,
  StaffSchedulingRepositoryError,
  type AvailabilityExceptionRecord,
  type ChangeAvailabilityExceptionStatusInput,
  type ChangeStaffStatusInput,
  type CreateAvailabilityExceptionInput,
  type CreateStaffInput,
  type ReorderStaffInput,
  type ReplaceWeeklyAvailabilityInput,
  type StaffSchedulingConflictCode,
  type StaffSchedulingRecord,
  type StaffSchedulingRecordItem,
  type StaffSchedulingRepository,
  type UpdateAvailabilityExceptionInput,
  type UpdateStaffInput,
  type WeeklyAvailabilityRecord,
} from './staff-scheduling-repository';
export {
  PortfolioMediaRepositoryError,
  PrismaPortfolioMediaRepository,
  type CompleteMediaVerificationInput,
  type CreatePortfolioMediaInput,
  type DeletePortfolioMediaInput,
  type MediaVerificationRecord,
  type PortfolioMediaConflictCode,
  type PortfolioMediaRecord,
  type PortfolioMediaRecordItem,
  type PortfolioMediaRepository,
  type ReorderPortfolioMediaInput,
  type UpdatePortfolioMediaInput,
} from './portfolio-media-repository';
export {
  MerchantPublicationRepositoryError,
  PrismaMerchantPublicationRepository,
  type MerchantPublicationConflictCode,
  type MerchantPublicationRecord,
  type MerchantPublicationRepository,
  type PublicMerchantRecord,
} from './merchant-publication-repository';
export {
  PrismaAvailabilityRepository,
  type AvailabilityProjection,
  type AvailabilityRepository,
} from './availability-repository';
export {
  BookingHoldRepositoryError,
  createBookingPolicyVersion,
  createBookingPolicyVersionV2,
  PrismaBookingHoldRepository,
  type AcquireBookingHoldInput,
  type BookingHoldConflictCode,
  type BookingHoldRateDecision,
  type BookingHoldRecord,
  type BookingHoldRepository,
} from './booking-hold-repository';
export {
  appointmentUsageMonth,
  AppointmentConfirmationRepositoryError,
  PrismaAppointmentConfirmationRepository,
  type AppointmentConfirmationErrorCode,
  type AppointmentConfirmationOutcome,
  type AppointmentConfirmationRecord,
  type AppointmentConfirmationRepository,
  type ConfirmAppointmentInput,
} from './appointment-confirmation-repository';
export {
  BookingPolicyRepositoryError,
  PrismaBookingPolicyRepository,
  type BookingPolicyRecord,
  type BookingPolicyRepository,
  type BookingPolicyRepositoryErrorCode,
} from './booking-policy-repository';
export {
  AppointmentLifecycleRepositoryError,
  PrismaAppointmentLifecycleRepository,
  type AppointmentLifecycleRepository,
  type AppointmentLifecycleRepositoryErrorCode,
  type AppointmentTransitionRecord,
  type MerchantSimpleAction,
} from './appointment-lifecycle-repository';
export {
  AppointmentViewRepositoryError,
  PrismaAppointmentViewRepository,
  type AppointmentHistoryRecord,
  type AppointmentListView,
  type AppointmentPageCursor,
  type AppointmentViewPage,
  type AppointmentViewRecord,
  type AppointmentViewRepository,
  type AppointmentViewRepositoryErrorCode,
  type MerchantAppointmentViewPage,
} from './appointment-view-repository';
export {
  PrismaLineWebhookRepository,
  type LineWebhookRepository,
  type RecordLineWebhookEventInput,
} from './line-webhook-repository';
export {
  PrismaNotificationProjectionRepository,
  type NotificationProjectionOutcome,
  type NotificationProjectionRepository,
} from './notification-projection-repository';
export {
  PrismaNotificationDispatchRepository,
  type NotificationDispatchClaim,
  type NotificationDispatchRepository,
  type NotificationExpirySweepOutcome,
  type NotificationOperationalSnapshot,
} from './notification-dispatch-repository';
export {
  PrismaNotificationDeliveryRepository,
  type NotificationDeliveryClaimOutcome,
  type NotificationDeliveryCompletion,
  type NotificationDeliveryRepository,
  type NotificationProviderResult,
  type NotificationTemplateData,
} from './notification-delivery-repository';
