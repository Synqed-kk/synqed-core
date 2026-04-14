-- Customers table: shared across karute and synq
-- tenant_id scopes all data to a business (was customer_id in karute)

create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null,
  name text not null,
  furigana text,
  email text,
  phone text,
  locale text default 'ja',
  notes text,
  contact_info text,
  assigned_staff_id uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Indexes
create index idx_customers_tenant on customers (tenant_id);
create index idx_customers_name on customers (tenant_id, name);
create index idx_customers_email on customers (tenant_id, email);
create unique index idx_customers_tenant_email on customers (tenant_id, email) where email is not null;

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger customers_updated_at
  before update on customers
  for each row execute function update_updated_at();

-- RLS
alter table customers enable row level security;

-- Service role bypasses RLS, so API calls with service_role key work.
-- No user-facing RLS policies needed since synqed-core is service-to-service only.
