export { SynqedClient, SynqedError } from './client.js'
export { CustomerClient } from './customers.js'
export { StaffClient } from './staff.js'
export { AppointmentClient } from './appointments.js'
export { SyncClient } from './sync.js'
export { RecordingClient } from './recordings.js'
export { KaruteRecordClient } from './karute.js'
export { AuditClient } from './audit.js'
export { OrgSettingsClient } from './org-settings.js'
export { AiRateLimitClient } from './ai-rate-limit.js'
export { StoreClient } from './stores.js'
export { EntitlementClient } from './entitlements.js'
export { StaffStoreClient } from './staff-stores.js'
export { InviteClient } from './invites.js'
export { CustomerMemoryClient } from './customer-memory.js'
export { KaruteOutcomeClient } from './karute-outcomes.js'
export { PacksClient } from './packs.js'
export { AiCacheClient } from './ai-cache.js'

export type {
  // Shared
  SynqedClientConfig,

  // Customers
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersOptions,
  ListCustomersResponse,
  CheckDuplicateResponse,
  CustomerEnrichment,
  CustomerPhoto,
  RecordingConsent,
  RecordingConsentMethod,
  GrantRecordingConsentInput,

  // Staff
  Staff,
  StaffRole,
  CreateStaffInput,
  UpdateStaffInput,
  ListStaffOptions,
  ListStaffResponse,

  // Appointments
  Appointment,
  AppointmentStatus,
  AppointmentSource,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  ListAppointmentsOptions,
  ListAppointmentsResponse,

  // Sync
  SyncConfig,
  SyncProvider,
  SyncStatus,
  UpsertSyncConfigInput,
  SyncRunResult,

  // Recordings
  Recording,
  RecordingStatus,
  CreateRecordingInput,
  UpdateRecordingInput,
  ListRecordingsOptions,
  ListRecordingsResponse,
  TranscriptionSegment,
  SegmentInput,

  // Karute
  KaruteRecord,
  KaruteStatus,
  KaruteEntry,
  KaruteEntryInput,
  AuditEventInput,
  AuditEvent,
  ListAuditOptions,
  ListAuditResponse,
  UpdateKaruteEntryInput,
  EntryAuthor,
  EntryEditAction,
  KaruteEntryEdit,
  ListEntryEditsOptions,
  ListEntryEditsResponse,
  EntryCategory,
  CreateKaruteRecordInput,
  UpdateKaruteRecordInput,
  ListKaruteRecordsOptions,
  ListKaruteRecordsResponse,

  // Org settings
  OrgSettings,
  UpsertOrgSettingsInput,

  // AI rate limit
  AiRateLimitResult,

  // Stores
  Store,
  CreateStoreInput,
  UpdateStoreInput,
  ListStoresResponse,

  // Entitlements
  Entitlement,
  UpsertEntitlementInput,

  // Staff stores
  StaffStoresResponse,
  StaffStoreCountsResponse,

  // Invites
  Invite,
  CreateInviteInput,
  ListInvitesResponse,

  // Customer memory
  MemoryItem,
  CreateMemoryItemInput,
  UpdateMemoryItemInput,
  ListMemoryItemsResponse,

  // Karute outcomes
  KaruteOutcome,
  UpsertKaruteOutcomeInput,

  // 回数券 packs subsystem
  Pack,
  ActivePack,
  CreatePackInput,
  AddRedemptionInput,
  RecentRedemption,
  Lifecycle,
  SetLifecycleInput,
  AlertDismissal,
  AddAlertDismissalInput,
  AddContactInput,
  RecentContact,
  AddVisitDismissalInput,
  VisitDismissal,
} from './types.js'
