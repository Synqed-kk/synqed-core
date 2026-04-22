export { SynqedClient, SynqedError } from './client.js'
export { CustomerClient } from './customers.js'
export { StaffClient } from './staff.js'
export { AppointmentClient } from './appointments.js'
export { SyncClient } from './sync.js'

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
} from './types.js'
