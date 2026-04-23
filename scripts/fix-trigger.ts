import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Drop the trigger temporarily
  console.log('Dropping trigger...')
  await prisma.$executeRawUnsafe('drop trigger if exists on_auth_user_created on auth.users;')

  // Recreate with better error handling
  console.log('Recreating handle_new_user function...')
  await prisma.$executeRawUnsafe(`
    create or replace function handle_new_user()
    returns trigger as $$
    begin
      insert into public.profiles (id, customer_id, full_name, role, display_role)
      values (
        new.id,
        coalesce((new.raw_user_meta_data->>'customer_id')::uuid, gen_random_uuid()),
        coalesce(new.raw_user_meta_data->>'full_name', new.email),
        'admin',
        'staff'
      );
      return new;
    exception when others then
      raise warning 'handle_new_user failed: %', sqlerrm;
      return new;
    end;
    $$ language plpgsql security definer;
  `)

  console.log('Recreating trigger...')
  await prisma.$executeRawUnsafe(`
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute procedure handle_new_user();
  `)

  console.log('Done. Testing user creation...')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
