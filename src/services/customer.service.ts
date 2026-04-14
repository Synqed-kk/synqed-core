import { supabase } from '../db/client.js'
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersResponse,
  CheckDuplicateResponse,
} from '../types/api.js'

export async function listCustomers(
  tenantId: string,
  options: {
    search?: string
    page?: number
    page_size?: number
    sort_by?: string
    sort_order?: string
  }
): Promise<ListCustomersResponse> {
  const page = options.page ?? 1
  const pageSize = options.page_size ?? 20
  const sortBy = options.sort_by ?? 'name'
  const sortOrder = options.sort_order ?? 'asc'
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)

  if (options.search) {
    query = query.or(
      `name.ilike.%${options.search}%,furigana.ilike.%${options.search}%,email.ilike.%${options.search}%,phone.ilike.%${options.search}%`
    )
  }

  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(offset, offset + pageSize - 1)

  const { data, count, error } = await query

  if (error) throw new Error(`Failed to list customers: ${error.message}`)

  const total = count ?? 0

  return {
    customers: data as Customer[],
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  }
}

export async function getCustomer(
  tenantId: string,
  id: string
): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`Failed to get customer: ${error.message}`)
  }

  return data as Customer
}

export async function createCustomer(
  tenantId: string,
  input: CreateCustomerInput
): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      furigana: input.furigana ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      locale: input.locale ?? 'ja',
      notes: input.notes ?? null,
      contact_info: input.contact_info ?? null,
      assigned_staff_id: input.assigned_staff_id ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create customer: ${error.message}`)

  return data as Customer
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  input: UpdateCustomerInput
): Promise<Customer> {
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) updates[key] = value
  }

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new Error('Customer not found')
    throw new Error(`Failed to update customer: ${error.message}`)
  }

  return data as Customer
}

export async function deleteCustomer(
  tenantId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`Failed to delete customer: ${error.message}`)
}

export async function checkDuplicateName(
  tenantId: string,
  name: string
): Promise<CheckDuplicateResponse> {
  const { data, error } = await supabase
    .from('customers')
    .select('name')
    .eq('tenant_id', tenantId)
    .ilike('name', name)
    .limit(1)

  if (error) throw new Error(`Failed to check duplicate: ${error.message}`)

  if (data && data.length > 0) {
    return { exists: true, existing_name: data[0].name }
  }

  return { exists: false }
}
