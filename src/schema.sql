CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('staff', 'owner', 'developer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE queue_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE receipt_status AS ENUM ('pending', 'sent', 'queued', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  preferred_staff_id UUID,
  preferred_service_id UUID,
  notes TEXT,
  total_visits INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, role)
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, category)
);

CREATE TABLE IF NOT EXISTS business_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  salon_name TEXT NOT NULL,
  address_line_1 TEXT NOT NULL,
  address_line_2 TEXT,
  public_phone TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp_business_number TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_business_settings CHECK (id = TRUE)
);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL UNIQUE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_by_role user_role NOT NULL DEFAULT 'staff',
  closed_at TIMESTAMPTZ,
  closed_by_role user_role,
  status session_status NOT NULL DEFAULT 'open',
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  cash_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  upi_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  card_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  insurance_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE customers
    ADD CONSTRAINT fk_customers_preferred_staff
    FOREIGN KEY (preferred_staff_id) REFERENCES staff(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers
    ADD CONSTRAINT fk_customers_preferred_service
    FOREIGN KEY (preferred_service_id) REFERENCES services(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  daily_session_id UUID REFERENCES daily_sessions(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  staff_id UUID NOT NULL REFERENCES staff(id),
  service_id UUID NOT NULL REFERENCES services(id),
  amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'paid',
  is_void BOOLEAN NOT NULL DEFAULT FALSE,
  voided_at TIMESTAMPTZ,
  voided_by_role user_role,
  void_reason TEXT,
  external_payment_reference TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'staff_entry',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  preferred_staff_id UUID REFERENCES staff(id),
  preferred_service_id UUID REFERENCES services(id),
  preference_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  receipt_number TEXT NOT NULL UNIQUE,
  image_path TEXT,
  image_url TEXT,
  pdf_path TEXT,
  delivery_channel TEXT NOT NULL DEFAULT 'whatsapp',
  status receipt_status NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  message_type TEXT NOT NULL DEFAULT 'time_to_return_whatsapp',
  due_date DATE NOT NULL,
  message_body TEXT NOT NULL,
  status queue_status NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, message_type, due_date)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT UNIQUE,
  payload JSONB NOT NULL,
  status queue_status NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_date ON transactions(customer_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_staff_date ON transactions(staff_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_status ON marketing_messages(status, due_date);
CREATE INDEX IF NOT EXISTS idx_webhook_status_retry ON webhook_events(status, next_retry_at);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_phone_snapshot TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS daily_session_id UUID REFERENCES daily_sessions(id);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_void BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS voided_by_role user_role;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(daily_session_id, is_void);

UPDATE transactions t
SET
  customer_name_snapshot = COALESCE(t.customer_name_snapshot, c.name),
  customer_phone_snapshot = COALESCE(t.customer_phone_snapshot, c.phone)
FROM customers c
WHERE c.id = t.customer_id
  AND (t.customer_name_snapshot IS NULL OR t.customer_phone_snapshot IS NULL);

INSERT INTO daily_sessions (business_date, opened_by_role, status)
SELECT DISTINCT transaction_date::date, 'developer'::user_role, 'closed'::session_status
FROM transactions
ON CONFLICT (business_date) DO NOTHING;

UPDATE transactions t
SET daily_session_id = ds.id
FROM daily_sessions ds
WHERE ds.business_date = t.transaction_date::date
  AND t.daily_session_id IS NULL;

UPDATE daily_sessions ds
SET
  total_visits = totals.total_visits,
  total_revenue = totals.total_revenue,
  cash_revenue = totals.cash_revenue,
  upi_revenue = totals.upi_revenue,
  card_revenue = totals.card_revenue,
  insurance_revenue = totals.insurance_revenue,
  updated_at = NOW()
FROM (
  SELECT
    daily_session_id,
    COUNT(*) FILTER (WHERE is_void = FALSE)::int AS total_visits,
    COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE), 0) AS total_revenue,
    COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'cash'), 0) AS cash_revenue,
    COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'upi'), 0) AS upi_revenue,
    COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'card'), 0) AS card_revenue,
    COALESCE(SUM(amount_paid) FILTER (WHERE is_void = FALSE AND payment_method = 'insurance'), 0) AS insurance_revenue
  FROM transactions
  WHERE daily_session_id IS NOT NULL
  GROUP BY daily_session_id
) totals
WHERE totals.daily_session_id = ds.id;
