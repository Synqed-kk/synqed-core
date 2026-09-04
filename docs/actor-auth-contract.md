# Actor-aware core authentication contract (G1)

Human-sensitive writes use two independent credentials:

1. `x-api-key` authenticates the trusted BFF and `x-business-id` selects its business scope.
2. `Authorization: Bearer <Supabase access token>` authenticates the human actor.

Core verifies the bearer token with Supabase Auth (`getUser(token)`), then resolves `user.id` to one active `staff.user_id` inside `x-business-id`. Missing or invalid tokens return `401`; a valid user without active business membership returns `403`. Request bodies and client-controlled staff headers never choose the actor.

Core computes the actor's current permission answer sheet on every protected request. The initial protected operations are:

- `PUT /v1/recordings/:id`: requires `records.write`; ordinary actors may update only sessions whose `staff_id` is their derived staff card. `recordings.viewAll` is the explicit elevated cross-owner capability.
- `PUT /v1/recording-discards/:id/confirmation`: requires both `records.delete` and `stores.viewAll` (the existing business-wide manager capability combination). Core derives `confirmed_by` and stamps `confirmed_at`; retries return the first immutable confirmation.

The SDK may receive an optional request-scoped `accessToken` and forwards it as the bearer token. Karute obtains that token from its server-side Supabase session; core remains the verification and authorization boundary.
