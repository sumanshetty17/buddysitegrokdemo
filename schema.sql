-- BuddySite PostgreSQL schema (Render-ready)
-- Nested store data (products, orders, customers, etc.) is stored as JSONB
-- on the sites row so the existing app logic stays the same, while users,
-- payments, subscriptions and the commission ledger are proper tables.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  plan            TEXT,
  plan_renews_at  TEXT,
  paid_cycles     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  store_name      TEXT NOT NULL,
  theme           TEXT NOT NULL DEFAULT 'simple',
  published       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- All nested store data lives here (products, categories, orders,
  -- customers, coupons, pages, hero slides, etc.)
  data            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sites_user_id ON sites(user_id);
CREATE INDEX IF NOT EXISTS idx_sites_slug ON sites(slug);

CREATE TABLE IF NOT EXISTS payments (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                TEXT,
  amount_paise        INTEGER,
  razorpay_order_id   TEXT,
  status              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                TEXT,
  razorpay_subscription_id TEXT UNIQUE,
  status              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commission_ledger (
  commission_id                 SERIAL PRIMARY KEY,
  order_id                      INTEGER NOT NULL,
  store_id                      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  seller_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_at_transaction           TEXT,
  commission_rate_at_transaction DOUBLE PRECISION,
  commission_base_amount        DOUBLE PRECISION,
  commission_amount             DOUBLE PRECISION,
  currency                      TEXT DEFAULT 'INR',
  payment_provider_fee          DOUBLE PRECISION,
  seller_payout_amount          DOUBLE PRECISION,
  status                        TEXT,
  refund_adjustment_amount      DOUBLE PRECISION DEFAULT 0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commission_store ON commission_ledger(store_id);
CREATE INDEX IF NOT EXISTS idx_commission_order ON commission_ledger(store_id, order_id);

CREATE TABLE IF NOT EXISTS razorpay_plans (
  plan_key          TEXT PRIMARY KEY,
  razorpay_plan_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name    TEXT PRIMARY KEY,
  value   INTEGER NOT NULL DEFAULT 1
);

INSERT INTO counters (name, value) VALUES
  ('nextProductId', 1),
  ('nextCategoryId', 1),
  ('nextOrderId', 1),
  ('nextHeroSlideId', 1),
  ('nextCategoryGroupId', 1),
  ('nextSlidingSectionId', 1),
  ('nextCouponId', 1),
  ('nextCustomerId', 1),
  ('nextAddressId', 1)
ON CONFLICT (name) DO NOTHING;
