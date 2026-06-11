-- Karute session columns + per-business customer chart numbers.
--
-- 1. karute_records: service / duration_minutes / session_date — captured by
--    the app's manual-create dialog but dropped server-side until now
--    (createManualKaruteRecord contract in the karute repo). session_date is
--    the actual session day (backdating); created_at stays the insert time.
--
-- 2. customers.karute_number: per-business sequential chart number (カルテNo).
--    Backfilled by created_at order; new customers get max+1 at create
--    (customer.service.ts / sync.service.ts). Unique per business; display
--    formatting (#00001) stays in the app.

alter table karute_records add column if not exists service text;
alter table karute_records add column if not exists duration_minutes integer;
alter table karute_records add column if not exists session_date date;

alter table customers add column if not exists karute_number integer;

update customers c
set karute_number = numbered.rn
from (
  select id, row_number() over (
    partition by business_id order by created_at, id
  ) as rn
  from customers
) numbered
where c.id = numbered.id
  and c.karute_number is null;

create unique index if not exists customers_business_id_karute_number_key
  on customers (business_id, karute_number);
