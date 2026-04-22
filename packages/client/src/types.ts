// ===========================================================================
// Shared config
// ===========================================================================

export interface SynqedClientConfig {
  baseUrl: string
  apiKey: string
  tenantId: string
}

// ===========================================================================
// Customers
// ===========================================================================

export interface Customer {
  id: string
  tenant_id: string
  name: string
  furigana: string | null
  email: string | null
  phone: string | null
  locale: string
  notes: string | null
  contact_info: string | null
  assigned_staff_id: string | null
  external_refs?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateCustomerInput {
  name: string
  furigana?: string | null
  email?: string | null
  phone?: string | null
  locale?: string
  notes?: string | null
  contact_info?: string | null
  assigned_staff_id?: string | null
}

export interface UpdateCustomerInput {
  name?: string
  furigana?: string | null
  email?: string | null
  phone?: string | null
  locale?: string
  notes?: string | null
  contact_info?: string | null
  assigned_staff_id?: string | null
}

export interface ListCustomersOptions {
  search?: string
  page?: number
  page_size?: number
  sort_by?: 'name' | 'created_at' | 'updated_at'
  sort_order?: 'asc' | 'desc'
}

export interface ListCustomersResponse {
  customers: Customer[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface CheckDuplicateResponse {
  exists: boolean
  existing_name?: string
}

// ===========================================================================
// Staff
// ===========================================================================

export type StaffRole = 'OWNER' | 'ADMIN' | 'STYLIST' | 'ASSISTANT'

export interface Staff {
  id: string
  tenant_id: string
  user_id: string | null
  name: string
  name_kana: string | null
  email: string | null
  role: StaffRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateStaffInput {
  name: string
  name_kana?: string | null
  email?: string | null
  user_id?: string | null
  role?: StaffRole
  is_active?: boolean
}

export interface UpdateStaffInput extends Partial<CreateStaffInput> {}

export interface ListStaffOptions {
  search?: string
  is_active?: boolean
  page?: number
  page_size?: number
}

export interface ListStaffResponse {
  staff: Staff[]
  total: number
  page: number
  page_size: number
}

// ===========================================================================
// Appointments
// ===========================================================================

export type AppointmentStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type AppointmentSource =
  | 'MANUAL'
  | 'QUICKRESERVE'
  | 'SYNQED_RESERVE'
  | 'SALON_BOARD'
  | 'HOT_PEPPER'
  | 'OTHER'

export interface Appointment {
  id: string
  tenant_id: string
  customer_id: string
  staff_id: string
  starts_at: string
  ends_at: string
  duration_minutes: number | null
  title: string | null
  notes: string | null
  status: AppointmentStatus
  source: AppointmentSource
  external_refs: Record<string, unknown>
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateAppointmentInput {
  customer_id: string
  staff_id: string
  starts_at: string
  ends_at: string
  duration_minutes?: number
  title?: string | null
  notes?: string | null
  status?: AppointmentStatus
  source?: AppointmentSource
}

export interface UpdateAppointmentInput {
  customer_id?: string
  staff_id?: string
  starts_at?: string
  ends_at?: string
  duration_minutes?: number | null
  title?: string | null
  notes?: string | null
  status?: AppointmentStatus
}

export interface ListAppointmentsOptions {
  from?: string
  to?: string
  staff_id?: string
  customer_id?: string
  status?: AppointmentStatus
  source?: AppointmentSource
  page?: number
  page_size?: number
}

export interface ListAppointmentsResponse {
  appointments: Appointment[]
  total: number
  page: number
  page_size: number
}

// ===========================================================================
// Sync
// ===========================================================================

export type SyncProvider = 'QUICKRESERVE' | 'SYNQED_RESERVE' | 'SALON_BOARD' | 'HOT_PEPPER'
export type SyncStatus = 'OK' | 'ERROR' | 'RUNNING'

export interface SyncConfig {
  id: string
  tenant_id: string
  provider: SyncProvider
  username: string | null
  store_slug: string | null
  store_id: number | null
  enabled: boolean
  interval_minutes: number
  business_hours_start: number
  business_hours_end: number
  timezone: string
  lookahead_days: number
  last_run_at: string | null
  last_run_status: SyncStatus | null
  last_run_error: string | null
  last_run_stats: unknown
  created_at: string
  updated_at: string
  has_credentials: boolean
}

export interface UpsertSyncConfigInput {
  username?: string
  password?: string
  store_slug?: string
  store_id?: number
  enabled?: boolean
  interval_minutes?: number
  business_hours_start?: number
  business_hours_end?: number
  timezone?: string
  lookahead_days?: number
}

export interface SyncRunResult {
  date_window: { start: string; end: string }
  total_fetched: number
  created: number
  updated: number
  cancelled: number
  skipped_no_staff: number
  skipped_deleted: number
  unmatched_staff: string[]
  duration_ms: number
}
