export interface Customer {
  id: string
  business_id: string
  name: string
  furigana: string | null
  email: string | null
  phone: string | null
  locale: string
  notes: string | null
  contact_info: string | null
  assigned_staff_id: string | null
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
