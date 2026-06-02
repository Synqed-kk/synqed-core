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
}

export interface ListCustomersQuery {
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

export interface ApiError {
  error: string
}

export interface CheckDuplicateResponse {
  exists: boolean
  existing_name?: string
}

// Hono env bindings — available via c.get('businessId')
export type AppEnv = {
  Variables: {
    businessId: string
  }
}
