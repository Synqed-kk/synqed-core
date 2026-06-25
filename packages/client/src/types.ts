// ===========================================================================
// Shared config
// ===========================================================================

export interface SynqedClientConfig {
  baseUrl: string
  apiKey: string
  businessId: string
}

// ===========================================================================
// Customers
// ===========================================================================

export interface Customer {
  id: string
  business_id: string
  name: string
  furigana: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  gender: string | null
  occupation: string | null
  member_number: string | null
  postal_code: string | null
  prefecture: string | null
  address: string | null
  phone2: string | null
  dm_opt_in: boolean
  comment: string | null
  remarks2: string | null
  total_sales: number
  installment_outstanding: number
  has_ticket_pack: boolean
  first_visit_at: string | null
  last_visit_at: string | null
  locale: string
  notes: string | null
  contact_info: string | null
  assigned_staff_id: string | null
  is_existing_customer: boolean
  visit_count: number
  karute_number: number | null
  external_refs?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateCustomerInput {
  name: string
  furigana?: string | null
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
  gender?: string | null
  occupation?: string | null
  member_number?: string | null
  postal_code?: string | null
  prefecture?: string | null
  address?: string | null
  phone2?: string | null
  dm_opt_in?: boolean
  comment?: string | null
  remarks2?: string | null
  total_sales?: number
  installment_outstanding?: number
  has_ticket_pack?: boolean
  first_visit_at?: string | null
  last_visit_at?: string | null
  locale?: string
  notes?: string | null
  contact_info?: string | null
  assigned_staff_id?: string | null
  is_existing_customer?: boolean
  visit_count?: number
}

export interface UpdateCustomerInput {
  name?: string
  furigana?: string | null
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
  gender?: string | null
  occupation?: string | null
  member_number?: string | null
  postal_code?: string | null
  prefecture?: string | null
  address?: string | null
  phone2?: string | null
  dm_opt_in?: boolean
  comment?: string | null
  remarks2?: string | null
  total_sales?: number
  installment_outstanding?: number
  has_ticket_pack?: boolean
  first_visit_at?: string | null
  last_visit_at?: string | null
  locale?: string
  notes?: string | null
  contact_info?: string | null
  assigned_staff_id?: string | null
  is_existing_customer?: boolean
  visit_count?: number
}

export interface CustomerVisit {
  id: string
  customer_id: string
  store_id: string | null
  qr_reservation_id: number
  used_at: string
  status: string
  course_name: string | null
  sales_amount: number
  staff_name: string | null
  treatment_comment: string | null
}

export interface UpsertVisitInput {
  qr_reservation_id: number
  used_at: string
  status: string
  course_name?: string | null
  sales_amount?: number
  staff_name?: string | null
  treatment_comment?: string | null
  store_id?: string | null
}

export interface ListCustomersOptions {
  search?: string
  // Scope to customers with an event at this karute location (store_id). Omitted
  // = business-wide (all locations).
  store_id?: string
  // When set, the server returns only the requested customers in one call
  // and skips search + pagination. Useful for resolving N customer names
  // without N round-trips.
  ids?: string[]
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

export interface CustomerPhoto {
  id: string
  customer_id: string
  storage_path: string
  category: string
  caption: string | null
  created_at: string
  signed_url: string | null
}

export type RecordingConsentMethod = 'VERBAL' | 'WRITTEN'

export interface RecordingConsent {
  id: string
  customer_id: string
  granted_by_staff_id: string
  granted_at: string
  method: RecordingConsentMethod
  policy_version: string
  revoked_at: string | null
  revoked_by_staff_id: string | null
}

export interface GrantRecordingConsentInput {
  granted_by_staff_id: string
  policy_version: string
  method?: RecordingConsentMethod
}

// ===========================================================================
// Staff
// ===========================================================================

export type StaffRole = 'OWNER' | 'ADMIN' | 'STYLIST' | 'ASSISTANT'

export interface Staff {
  id: string
  business_id: string
  user_id: string | null
  name: string
  name_kana: string | null
  email: string | null
  role: StaffRole
  is_active: boolean
  avatar_url: string | null
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
// Stores (physical locations)
// ===========================================================================

export interface Store {
  id: string
  business_id: string
  name: string
  address: string | null
  phone: string | null
  is_primary: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface CreateStoreInput {
  name: string
  address?: string | null
  phone?: string | null
  is_primary?: boolean
  active?: boolean
}

export interface UpdateStoreInput {
  name?: string
  address?: string | null
  phone?: string | null
  active?: boolean
}

export interface ListStoresResponse {
  stores: Store[]
}

export interface Entitlement {
  business_id: string
  tier: string
  is_unlimited: boolean
}

export interface UpsertEntitlementInput {
  tier?: string
  is_unlimited?: boolean
}

export interface StaffStoresResponse {
  store_ids: string[]
}

export interface StaffStoreCountsResponse {
  counts: Record<string, number>
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
  business_id: string
  customer_id: string
  staff_id: string
  store_id: string | null
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
  store_id?: string | null
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
  store_id?: string
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
  business_id: string
  provider: SyncProvider
  username: string | null
  store_slug: string | null
  store_id: number | null
  karute_store_id: string | null
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
  karute_store_id?: string | null
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

// ===========================================================================
// Recordings
// ===========================================================================

export type RecordingStatus =
  | 'RECORDING'
  | 'UPLOADING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'

export interface Recording {
  id: string
  business_id: string
  customer_id: string | null
  store_id: string | null
  staff_id: string
  appointment_id: string | null
  audio_storage_path: string | null
  duration_seconds: number | null
  status: RecordingStatus
  created_at: string
  updated_at: string
}

export interface CreateRecordingInput {
  customer_id?: string | null
  store_id?: string | null
  staff_id: string
  appointment_id?: string | null
  audio_storage_path?: string | null
  duration_seconds?: number | null
  status?: RecordingStatus
  created_at?: string
}

export interface UpdateRecordingInput {
  customer_id?: string | null
  audio_storage_path?: string | null
  duration_seconds?: number | null
  status?: RecordingStatus
}

export interface ListRecordingsOptions {
  from?: string
  to?: string
  date?: string
  customer_id?: string
  store_id?: string
  staff_id?: string
  status?: RecordingStatus
  page?: number
  page_size?: number
}

export interface ListRecordingsResponse {
  recordings: Recording[]
  total: number
  page: number
  page_size: number
}

export interface TranscriptionSegment {
  id: string
  recording_session_id: string
  segment_index: number
  text: string
  start_time: number
  end_time: number
  speaker_label: string | null
  confidence: number | null
  created_at: string
}

export interface SegmentInput {
  segment_index: number
  text: string
  start_time: number
  end_time: number
  speaker_label?: string | null
  confidence?: number | null
}

// ===========================================================================
// Karute records
// ===========================================================================

export type KaruteStatus = 'DRAFT' | 'REVIEW' | 'APPROVED'

export type EntryCategory =
  | 'SYMPTOM'
  | 'TREATMENT'
  | 'BODY_AREA'
  | 'PREFERENCE'
  | 'LIFESTYLE'
  | 'NEXT_VISIT'
  | 'PRODUCT'
  | 'OTHER'

export interface KaruteEntry {
  id: string
  karute_record_id: string
  category: EntryCategory
  content: string
  original_quote: string | null
  confidence: number
  tags: string[]
  sort_order: number
  is_manual: boolean
  created_at: string
  updated_at: string
}

export interface KaruteEntryInput {
  category: EntryCategory
  content: string
  original_quote?: string | null
  confidence?: number | null
  tags?: string[]
  sort_order?: number
  is_manual?: boolean
}

export interface KaruteRecord {
  id: string
  business_id: string
  customer_id: string | null
  store_id: string | null
  staff_id: string
  appointment_id: string | null
  recording_session_id: string | null
  status: KaruteStatus
  ai_summary: string | null
  transcript: string | null
  service: string | null
  duration_minutes: number | null
  /** YYYY-MM-DD — the actual session day (backdating); created_at is insert time. */
  session_date: string | null
  created_at: string
  updated_at: string
  entries?: KaruteEntry[]
  entry_count?: number
  recording_session?: {
    id: string
    segments: Array<{
      id: string
      segment_index: number
      text: string
      start_time: number
      end_time: number
      speaker_label: string | null
      confidence: number | null
    }>
  }
}

export interface CreateKaruteRecordInput {
  customer_id?: string | null
  store_id?: string | null
  staff_id: string
  appointment_id?: string | null
  recording_session_id?: string | null
  status?: KaruteStatus
  ai_summary?: string | null
  transcript?: string | null
  entries?: KaruteEntryInput[]
  service?: string | null
  duration_minutes?: number | null
  session_date?: string | null
}

export interface UpdateKaruteRecordInput {
  customer_id?: string | null
  appointment_id?: string | null
  status?: KaruteStatus
  ai_summary?: string | null
  transcript?: string | null
  entries?: KaruteEntryInput[]
  service?: string | null
  duration_minutes?: number | null
  session_date?: string | null
}

export interface ListKaruteRecordsOptions {
  customer_id?: string
  store_id?: string
  staff_id?: string
  recording_session_id?: string
  appointment_id?: string
  status?: KaruteStatus
  from?: string
  to?: string
  page?: number
  page_size?: number
}

export interface ListKaruteRecordsResponse {
  karute_records: KaruteRecord[]
  total: number
  page: number
  page_size: number
}

// ===========================================================================
// Org settings
// ===========================================================================

export interface OrgSettings {
  business_id: string
  name: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface UpsertOrgSettingsInput {
  name?: string | null
  settings?: Record<string, unknown>
}

// ===========================================================================
// AI rate limit
// ===========================================================================

export interface AiRateLimitResult {
  allowed: boolean
  reason: 'ok' | 'hourly_count' | 'daily_cost'
  cap: number
  used: number
  remaining: number
  costCap: number
  costUsed: number
  resetAt: string
}
