-- CORE-2: per-issuing-store points; no historic customer claiming.
BEGIN;
-- CreateTable
CREATE TABLE "member_accounts" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "member_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_wallets" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_entries" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "event_ref" TEXT NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_point_policies" (
    "store_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "daily_open_points" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_point_policies_pkey" PRIMARY KEY ("store_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_accounts_auth_user_id_key" ON "member_accounts"("auth_user_id");

-- CreateIndex
CREATE INDEX "point_wallets_business_id_store_id_idx" ON "point_wallets"("business_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_wallets_account_id_store_id_key" ON "point_wallets"("account_id", "store_id");

-- CreateIndex
CREATE INDEX "point_entries_wallet_id_occurred_at_id_idx" ON "point_entries"("wallet_id", "occurred_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "point_entries_wallet_id_source_event_ref_key" ON "point_entries"("wallet_id", "source", "event_ref");

-- CreateIndex
CREATE UNIQUE INDEX "store_point_policies_store_id_business_id_key" ON "store_point_policies"("store_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_id_business_id_key" ON "stores"("id", "business_id");

-- AddForeignKey
ALTER TABLE "point_wallets" ADD CONSTRAINT "point_wallets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "member_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_wallets" ADD CONSTRAINT "point_wallets_store_id_business_id_fkey" FOREIGN KEY ("store_id", "business_id") REFERENCES "stores"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "point_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_point_policies" ADD CONSTRAINT "store_point_policies_store_id_business_id_fkey" FOREIGN KEY ("store_id", "business_id") REFERENCES "stores"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger corrections append a compensating entry; existing entries never change.
ALTER TABLE point_entries ADD CONSTRAINT point_entries_nonzero CHECK (amount <> 0);
ALTER TABLE point_entries ADD CONSTRAINT point_entries_source_sign CHECK (
  (source IN ('DAILY_OPEN','VISIT_CHECKIN','CONTENT_READ','REFERRAL_REFERRER','REFERRAL_FRIEND') AND amount > 0)
  OR (source = 'DISCOUNT_REDEMPTION' AND amount < 0)
  OR source = 'ADMIN_ADJUST'
);
ALTER TABLE store_point_policies ADD CONSTRAINT daily_open_points_range CHECK (daily_open_points BETWEEN 0 AND 1000);
CREATE FUNCTION prevent_point_entry_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Point entries are append-only; append an adjustment';
END $$;
CREATE TRIGGER point_entries_append_only BEFORE UPDATE OR DELETE ON point_entries
FOR EACH ROW EXECUTE FUNCTION prevent_point_entry_changes();

-- Core verifies the human actor on every request. No browser/PostgREST access.
ALTER TABLE member_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_point_policies ENABLE ROW LEVEL SECURITY;
COMMIT;
