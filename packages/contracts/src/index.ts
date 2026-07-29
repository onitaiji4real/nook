export type HealthStatus = 'ok' | 'ready' | 'unavailable';

export interface HealthResponse {
  readonly status: HealthStatus;
  readonly service: string;
  readonly version: string;
  readonly timestamp: string;
}

export type { ProblemDetails } from './problem-details';
export {
  browserRuntimeConfigResponseSchema,
  type BrowserRuntimeConfigResponse,
} from './browser-session';
export {
  lineExchangeRequestSchema,
  type LineExchangeRequest,
  type LineExchangeResponse,
} from './auth';
export {
  createTenantRequestSchema,
  meMembershipSchema,
  meResponseSchema,
  membershipRoleSchema,
  membershipStatusSchema,
  tenantIdSchema,
  tenantStatusSchema,
  type CreateTenantRequest,
  type MeResponse,
  type TenantResponse,
} from './tenant';
export {
  buildMerchantLineRedirectUrl,
  merchantStudioEntryEventRequestSchema,
  merchantStudioEntryOutcomeSchema,
  parseStudioRouteKey,
  resolveStudioNavigation,
  studioMembershipRoleSchema,
  studioNavigationDecisionSchema,
  studioRouteKeySchema,
  type MerchantStudioEntryEventRequest,
  type MerchantStudioEntryOutcome,
  type StudioMembershipRole,
  type StudioNavigationDecision,
  type StudioRouteAccess,
  type StudioRouteKey,
} from './studio-entry';
export {
  merchantOnboardingRequestSchema,
  servicePriceSchema,
  type MerchantOnboardingRequest,
  type MerchantOnboardingResponse,
} from './merchant-onboarding';
export {
  changeServiceStatusRequestSchema,
  createServiceRequestSchema,
  reorderServicesRequestSchema,
  serviceIdSchema,
  updateServiceRequestSchema,
  type ChangeServiceStatusRequest,
  type CreateServiceRequest,
  type ReorderServicesRequest,
  type ServiceCatalogItem,
  type ServiceCatalogResponse,
  type UpdateServiceRequest,
} from './service-catalog';
export {
  availabilityExceptionIdSchema,
  changeAvailabilityExceptionStatusRequestSchema,
  changeStaffStatusRequestSchema,
  createAvailabilityExceptionRequestSchema,
  createStaffRequestSchema,
  reorderStaffRequestSchema,
  replaceWeeklyAvailabilityRequestSchema,
  staffIdSchema,
  updateAvailabilityExceptionRequestSchema,
  updateStaffRequestSchema,
  weeklyAvailabilityRuleSchema,
  type ChangeAvailabilityExceptionStatusRequest,
  type ChangeStaffStatusRequest,
  type CreateAvailabilityExceptionRequest,
  type CreateStaffRequest,
  type ReorderStaffRequest,
  type ReplaceWeeklyAvailabilityRequest,
  type StaffAvailabilityItem,
  type StaffAvailabilityResponse,
  type UpdateAvailabilityExceptionRequest,
  type UpdateStaffRequest,
} from './staff-availability';
export {
  completePortfolioUploadRequestSchema,
  createPortfolioUploadIntentRequestSchema,
  mediaAssetIdSchema,
  portfolioImageMimeTypeSchema,
  portfolioItemIdSchema,
  reorderPortfolioItemsRequestSchema,
  updatePortfolioItemRequestSchema,
  verifyMediaTaskRequestSchema,
  type CreatePortfolioUploadIntentRequest,
  type PortfolioImageMimeType,
  type PortfolioItemResponse,
  type PortfolioResponse,
  type PortfolioUploadCompleteResponse,
  type PortfolioUploadIntentResponse,
  type ReorderPortfolioItemsRequest,
  type UpdatePortfolioItemRequest,
  type VerifyMediaTaskRequest,
  type VerifyMediaTaskResponse,
} from './portfolio-media';
export {
  merchantSlugSchema,
  merchantVisibilityRequestSchema,
  portfolioPublicationRequestSchema,
  type MerchantPublicationResponse,
  type MerchantVisibilityRequest,
  type PortfolioPublicationRequest,
  type PublicationReadinessCode,
  type PublicationReadinessItem,
  type PublicMerchantResponse,
} from './merchant-publication';
export {
  availabilityQuerySchema,
  type AvailabilityQuery,
  type PublicAvailabilityResponse,
} from './availability';
export {
  bookingHoldIdSchema,
  bookingHoldIdempotencyKeySchema,
  createBookingHoldRequestSchema,
  type BookingHoldResponse,
  type CreateBookingHoldRequest,
} from './booking-hold';
export {
  appointmentIdempotencyKeySchema,
  appointmentPolicyVersionSchema,
  createAppointmentRequestSchema,
  type AppointmentResponse,
  type CreateAppointmentRequest,
} from './appointment';
export {
  appointmentStatusSchema,
  appointmentViewSchema,
  canonicalAppointmentIdSchema,
  canonicalUtcTimestampSchema,
  consumerAppointmentListQuerySchema,
  merchantAppointmentListQuerySchema,
  type AppointmentHistoryItem,
  type AppointmentLocationSummary,
  type AppointmentServiceSnapshot,
  type AppointmentStaffSnapshot,
  type AppointmentStatus,
  type AppointmentView,
  type ConsumerAppointmentDetail,
  type ConsumerAppointmentListQuery,
  type ConsumerAppointmentListResponse,
  type ConsumerAppointmentSummary,
  type MerchantAppointmentDetail,
  type MerchantAppointmentListQuery,
  type MerchantAppointmentListResponse,
  type MerchantAppointmentSummary,
} from './appointment-view';
export {
  appointmentLifecycleIdempotencyKeySchema,
  appointmentTransitionResponseSchema,
  bookingPolicyUpdateRequestSchema,
  consumerCancelAppointmentRequestSchema,
  consumerCancelReasonSchema,
  emptyAppointmentTransitionRequestSchema,
  merchantCancelAppointmentRequestSchema,
  merchantCancelReasonSchema,
  rescheduleAppointmentRequestSchema,
  rescheduleReasonSchema,
  type AppointmentTransitionResponse,
  type BookingPolicyResponse,
  type BookingPolicyUpdateRequest,
  type ConsumerAppointmentLifecycle,
  type ConsumerCancelAppointmentRequest,
  type ConsumerCancelReason,
  type ConsumerLifecycleAction,
  type ConsumerRescheduleContext,
  type MerchantAppointmentLifecycle,
  type MerchantCancelAppointmentRequest,
  type MerchantCancelReason,
  type MerchantLifecycleAction,
  type RescheduleAppointmentRequest,
  type RescheduleReason,
} from './appointment-lifecycle';
export {
  grantMarketingConsentRequestSchema,
  marketingConsentExpectedRevisionSchema,
  marketingConsentIdempotencyKeySchema,
  marketingConsentPurposeSchema,
  marketingConsentTenantIdSchema,
  type GrantMarketingConsentRequest,
  type MarketingConsentResponse,
} from './marketing-consent';
export {
  customerIdSchema,
  customerListQuerySchema,
  type CustomerDetail,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerSummary,
  type CustomerTag,
} from './customer-crm';
export {
  changeCustomerTagDefinitionStatusRequestSchema,
  createCustomerTagDefinitionRequestSchema,
  customerTagIdSchema,
  type ChangeCustomerTagDefinitionStatusRequest,
  type CreateCustomerTagDefinitionRequest,
  type CustomerTagDefinition,
} from './customer-tags';

export interface HealthResponseInput {
  readonly status: HealthStatus;
  readonly service: string;
  readonly version: string;
  readonly now?: Date;
}

export function createHealthResponse(input: HealthResponseInput): HealthResponse {
  return {
    status: input.status,
    service: input.service,
    version: input.version,
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}
