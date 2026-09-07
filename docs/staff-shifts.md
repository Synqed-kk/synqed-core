# Staff shifts (CORE-8)

`client.staffShifts` exposes create/get/list/update/delete at `/v1/staff-shifts`.
Each row belongs to one business, staff member, store, and local calendar date.
That key is unique; concurrent duplicate creates return 409.

`date` is `YYYY-MM-DD`. `start`, `end`, and each break/block's `start`/`end` are
integer minutes from that date's local midnight, matching the Business day-board
coordinate system. Windows use `[start, end)` inside 0–1440. Overnight work is
represented by one row on each date. Breaks and blocks must be inside the working
window and cannot overlap each other. An absent shift means no scheduled work.

Create defaults breaks and blocks to empty arrays. Update changes only the working
window/breaks/blocks; omitted fields are preserved and empty arrays clear them.
Partial updates validate the merged row while holding a row lock. Rescheduling to
another date/store/person uses a new row and deletion of the old row.

Reads use the existing trusted-BFF API key/business scope. Writes also require the
verified bearer actor, `staff.manage`, and access to the shift's store according to
the core permission answer sheet. Attribution is derived from that actor. Create
requires active staff and an active store in the selected business.

List accepts `staff_id`, `store_id`, `date`, and a date range (`from` inclusive,
`to` exclusive), plus `page`/`page_size` (default 100, max 200). It returns
`shifts`, `total`, `page`, `page_size`, ordered by date/staff/id. The Business board
can request its store and date, following pagination until all rows are read.
This API does not silently create booking blocks or alter existing appointments.

Apply `prisma/migrations/manual/2026-09-07-staff-shifts.sql` before deploying.
SDK publication and replacing the app's fixture reads follow deployment.
