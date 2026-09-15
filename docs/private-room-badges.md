# Private-room bookings and staff badges (CORE-14 / CORE-15)

Apply `prisma/migrations/manual/2026-09-07-private-room-badges.sql` before deploying the API. Existing bookings stay false; existing customers receive empty badges. No retrospective tagging. Release the SDK after deployment before updating consumers.

At booking creation, an explicit true flag, a private menu, or the customer badge 個室希望 sets `requires_private_room`. Later writes preserve the stored flag unless explicitly changed. Staff may clear the flag even for a private menu. Active flagged bookings can hold only private beds; clear/move/release the claim before enabling the flag on a standard bed. Restores check the stored flag. Bed downgrades and booking writes share the resource row lock. QR updates keep the stored flag; an incompatible claim is released under the same lock, following the existing sync conflict policy.

`GET /v1/resources/available-for-appointment/:id` returns active free beds using the saved flag; optional `starts_at` / `ends_at` query values inspect a proposed window. It excludes other bookings and blocks with cleanup, preserves the booking’s existing cleanup snapshot, and orders private beds last. These are independent alternatives for one existing booking, not CORE-9’s whole-window advertised-inventory matching engine.

Staff customer create/read/list/update payloads contain `staff_badges`. `GET /v1/customer-badges` reads the business vocabulary; `PUT` replaces it with HQ authorization and an audit event. Badge definitions have name, hex colour, and display_order; defaults are 個室希望 and 要注意. The field is intentionally separate from generic organization settings and member ranks.

Privacy: Core routes require a trusted server API key and business scope. Reserve’s current public booking/create/manage handlers explicitly select response fields and never serialize Customer objects. There is no real `/me` backend in the checked Reserve checkout; member DTO non-disclosure must be verified when CORE-2/13 implements it. Do not forward Core’s staff Customer DTO to member endpoints.

Rollback: roll back the API/SDK first; leave the additive columns in place to preserve stored staff intent. Production migration and package publication are release steps, not performed by the local implementation tests.
