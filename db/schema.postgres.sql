-- PostgreSQL schema reference for Vercel/Neon.
-- The current Express routes still use synchronous SQLite; this schema is not a finished adapter.

CREATE TABLE IF NOT EXISTS "session" (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON "session" (expire);
CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS packages (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price BIGINT NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  alternative_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  whatsapp_phone TEXT NOT NULL DEFAULT '',
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS providers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  classification TEXT NOT NULL,
  coverage TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  fee_type TEXT NOT NULL DEFAULT 'quote',
  fee BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  account_details TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  reference_required BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  tracking_token TEXT UNIQUE NOT NULL,
  idempotency_key TEXT UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  package_id BIGINT NOT NULL REFERENCES packages(id),
  package_name TEXT NOT NULL,
  package_price BIGINT NOT NULL CHECK (package_price >= 0),
  destination_type TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  district_city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  delivery_method TEXT NOT NULL,
  provider_id BIGINT REFERENCES providers(id),
  provider_name TEXT NOT NULL DEFAULT '',
  delivery_fee BIGINT CHECK (delivery_fee IS NULL OR delivery_fee >= 0),
  pickup_self BOOLEAN,
  collector_name TEXT NOT NULL DEFAULT '',
  collector_phone TEXT NOT NULL DEFAULT '',
  payment_method_id BIGINT REFERENCES payment_methods(id),
  payment_method_name TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'Awaiting Payment',
  order_status TEXT NOT NULL DEFAULT 'New',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payment_evidence (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  payer_name TEXT NOT NULL,
  payer_phone TEXT NOT NULL,
  transaction_reference TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS payment_verification_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  admin_id BIGINT REFERENCES admins(id),
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  admin_id BIGINT REFERENCES admins(id),
  event_type TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notification_history (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id),
  channel TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS regions (
  id BIGSERIAL PRIMARY KEY,
  country_code TEXT NOT NULL DEFAULT 'TZ',
  name TEXT NOT NULL,
  UNIQUE(country_code, name)
);
CREATE TABLE IF NOT EXISTS districts (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(region_id, name)
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(payment_status, order_status);
CREATE INDEX IF NOT EXISTS payment_evidence_order_idx ON payment_evidence(order_id);
CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_history(order_id, created_at DESC);
