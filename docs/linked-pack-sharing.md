# CORE-6 — family pack sharing

This branch builds on CORE-12 (PR #86). Apply its pack-correction migration, then `2026-09-07-linked-pack-sharing.sql`, before deploying. Publish the Core SDK after merge; deploy the paired Karute consumer change to enable family badges. No production family records have been linked; confirm exact customer IDs for the five named families before seeding them.

A family is a tenant-scoped `pack_sharing_group_id` on customers. GET/PUT `/v1/customer-links/:anchor` and SDK `customers.getPackSharing/setPackSharing` read or replace the complete member set. PUT requires HQ authorization, 1–20 unique live customer IDs including the anchor; one member unlinks the family. It refuses accidental merges with another existing family. Customer data is never merged.

Pack ownership stays on its original customer. A customer’s pack list contains their own history plus linked members’ active packs. List rows include `usage_count` and `usage_last_redeemed_on` from all visitors’ nonremoved redemptions in one snapshot. Active-pack bulk rows expose optional `eligible_customer_ids`; each pack still appears once. Default redemption-by-customer reads remain visitor-only for existing visit/reassignment callers; `include_shared=true` is an explicit balance read.

The supplied redemption customer is the visitor. Existing appointment/karute references must match that customer. Cross-customer burns require a current link and active pack. Manual/auto burns serialize and cannot spend a final unit twice; historical import/correction sources retain their accounting contract. A holder’s historical correction can still reference their retained ledger after customer deletion. Link edits, burns, undo and customer hard deletion share a business-scoped transaction lock.

Redemptions snapshot `pack_holder_customer_id`; shared redeem/undo always write an additional small audit event with both identities, even without a caller-provided audit. Undo remains possible after unlinking because it reverses historical usage. Migration extends the existing controlled audit-erasure function to family references. Subsequent undo hashes an erased customer’s audit reference; ledger IDs remain for accounting under the existing deletion contract.

Karute’s individual picker uses the Core usage snapshot when available and falls back for older responses. List/appointment badges and burn targets include each eligible family member. Monetary rollups and holder counts attribute ownership once, preventing a three-person family from tripling the pack liability.

Rollback: roll back apps before Core and preserve additive columns. Do not restore the old audit scrub while any family audit events remain. Migration, SDK publication, production family seeding and deployed human validation remain release steps.
