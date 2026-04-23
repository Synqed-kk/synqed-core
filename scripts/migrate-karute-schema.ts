import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Running karute schema migrations on synqed-core database...\n')

  // 1. Profiles table
  console.log('1. Creating profiles table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists profiles (
      id uuid references auth.users on delete cascade primary key,
      customer_id uuid not null,
      full_name text,
      role text default 'staff' check (role in ('admin', 'staff')),
      display_role text default 'staff',
      created_at timestamptz default now() not null
    );
  `)

  // 2. Profiles RLS
  console.log('2. Setting up profiles RLS...')
  await prisma.$executeRawUnsafe(`alter table profiles enable row level security;`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can read all profiles" on profiles;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can read all profiles" on profiles for select to authenticated using (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can insert profiles" on profiles;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can insert profiles" on profiles for insert to authenticated with check (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can update profiles" on profiles;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can update profiles" on profiles for update to authenticated using (true) with check (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can delete profiles" on profiles;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can delete profiles" on profiles for delete to authenticated using (true);`)

  // 3. Handle new user trigger
  console.log('3. Creating handle_new_user trigger...')
  await prisma.$executeRawUnsafe(`
    create or replace function handle_new_user()
    returns trigger as $$
    begin
      insert into profiles (id, customer_id, full_name)
      values (
        new.id,
        coalesce((new.raw_user_meta_data->>'customer_id')::uuid, gen_random_uuid()),
        coalesce(new.raw_user_meta_data->>'full_name', new.email)
      );
      return new;
    end;
    $$ language plpgsql security definer;
  `)
  await prisma.$executeRawUnsafe(`
    drop trigger if exists on_auth_user_created on auth.users;
  `)
  await prisma.$executeRawUnsafe(`
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute procedure handle_new_user();
  `)

  // 4. Karute records table
  console.log('4. Creating karute_records table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists karute_records (
      id uuid default gen_random_uuid() primary key,
      customer_id uuid not null,
      client_id uuid references customers(id) on delete cascade not null,
      staff_profile_id uuid references profiles(id) on delete set null,
      session_date timestamptz default now() not null,
      transcript text,
      summary text,
      created_at timestamptz default now() not null,
      updated_at timestamptz default now() not null
    );
  `)
  await prisma.$executeRawUnsafe(`alter table karute_records enable row level security;`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Users access own customer's records" on karute_records;`)
  await prisma.$executeRawUnsafe(`create policy "Users access own customer's records" on karute_records for all to authenticated using (customer_id = (select customer_id from profiles where id = (select auth.uid()))) with check (customer_id = (select customer_id from profiles where id = (select auth.uid())));`)

  // 5. Entries table
  console.log('5. Creating entries table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists entries (
      id uuid default gen_random_uuid() primary key,
      karute_record_id uuid references karute_records(id) on delete cascade not null,
      customer_id uuid not null,
      category text not null check (category in ('Preference', 'Treatment', 'Lifestyle', 'Physical', 'Note')),
      content text not null,
      source_quote text,
      confidence_score numeric(3,2) check (confidence_score >= 0 and confidence_score <= 1),
      is_manual boolean default false not null,
      created_at timestamptz default now() not null
    );
  `)
  await prisma.$executeRawUnsafe(`alter table entries enable row level security;`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Users access own customer's entries" on entries;`)
  await prisma.$executeRawUnsafe(`create policy "Users access own customer's entries" on entries for all to authenticated using (customer_id = (select customer_id from profiles where id = (select auth.uid()))) with check (customer_id = (select customer_id from profiles where id = (select auth.uid())));`)

  // 6. Appointments table
  console.log('6. Creating appointments table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists appointments (
      id uuid default gen_random_uuid() primary key,
      staff_profile_id uuid references profiles(id) on delete cascade not null,
      client_id uuid references customers(id) on delete cascade not null,
      start_time timestamptz not null,
      duration_minutes integer not null default 60,
      title text,
      notes text,
      karute_record_id uuid references karute_records(id) on delete set null,
      created_at timestamptz default now() not null,
      updated_at timestamptz default now() not null
    );
  `)
  await prisma.$executeRawUnsafe(`alter table appointments enable row level security;`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can read appointments" on appointments;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can read appointments" on appointments for select to authenticated using (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can insert appointments" on appointments;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can insert appointments" on appointments for insert to authenticated with check (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can update appointments" on appointments;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can update appointments" on appointments for update to authenticated using (true) with check (true);`)
  await prisma.$executeRawUnsafe(`drop policy if exists "Authenticated users can delete appointments" on appointments;`)
  await prisma.$executeRawUnsafe(`create policy "Authenticated users can delete appointments" on appointments for delete to authenticated using (true);`)

  // 7. Organization settings table
  console.log('7. Creating organization_settings table...')
  await prisma.$executeRawUnsafe(`
    create table if not exists organization_settings (
      id uuid default gen_random_uuid() primary key,
      owner_profile_id uuid references profiles(id) on delete cascade not null,
      salon_name text default '' not null,
      business_type text default 'other' not null,
      webhook_url text default '' not null,
      ai_model text default 'gpt-4o-mini' not null,
      confidence_threshold numeric(3,2) default 0.7 not null,
      audio_quality text default 'standard' not null,
      auto_stop_minutes integer default 30 not null,
      operating_hours jsonb not null default '{
        "mon": {"openMinute": 600, "closeMinute": 1440},
        "tue": {"openMinute": 600, "closeMinute": 1440},
        "wed": {"openMinute": 600, "closeMinute": 1440},
        "thu": {"openMinute": 600, "closeMinute": 1440},
        "fri": {"openMinute": 600, "closeMinute": 1440},
        "sat": {"openMinute": 600, "closeMinute": 1440},
        "sun": {"openMinute": 600, "closeMinute": 1440}
      }'::jsonb,
      created_at timestamptz default now() not null,
      updated_at timestamptz default now() not null
    );
  `)

  // 8. Updated_at triggers
  console.log('8. Creating updated_at triggers...')
  await prisma.$executeRawUnsafe(`
    create or replace function update_updated_at_column()
    returns trigger as $$
    begin
      new.updated_at = now();
      return new;
    end;
    $$ language plpgsql;
  `)
  await prisma.$executeRawUnsafe(`drop trigger if exists update_karute_records_updated_at on karute_records;`)
  await prisma.$executeRawUnsafe(`create trigger update_karute_records_updated_at before update on karute_records for each row execute procedure update_updated_at_column();`)
  await prisma.$executeRawUnsafe(`drop trigger if exists update_appointments_updated_at on appointments;`)
  await prisma.$executeRawUnsafe(`create trigger update_appointments_updated_at before update on appointments for each row execute procedure update_updated_at_column();`)

  console.log('\n=== All migrations complete ===')
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
