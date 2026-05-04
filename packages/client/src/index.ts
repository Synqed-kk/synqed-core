export { SynqedClient, SynqedError } from './client.js'
export { CustomerClient } from './customers.js'
export { StaffClient } from './staff.js'
export { AppointmentClient } from './appointments.js'
export { SyncClient } from './sync.js'
export { RecordingClient } from './recordings.js'
export { KaruteRecordClient } from './karute.js'
export { OrgSettingsClient } from './org-settings.js'

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
  EntryCategory,
  CreateKaruteRecordInput,
  UpdateKaruteRecordInput,
  ListKaruteRecordsOptions,
  ListKaruteRecordsResponse,

  // Org settings
  OrgSettings,
  UpsertOrgSettingsInput,
} from './types.js'
