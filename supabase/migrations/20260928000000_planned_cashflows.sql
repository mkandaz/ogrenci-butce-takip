-- ==============================================================================
-- FAZ 5.5B — PLANNED CASHFLOWS MIGRATION & RLS POLICIES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS planned_cashflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  recurrence TEXT NOT NULL CHECK (recurrence IN ('monthly', 'once')),
  day_of_month INT,
  date DATE,
  start_date DATE,
  end_date DATE,
  category_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_monthly_planned CHECK (
    (recurrence = 'monthly' AND day_of_month IS NOT NULL AND day_of_month BETWEEN 1 AND 31 AND date IS NULL)
    OR
    (recurrence = 'once')
  ),
  CONSTRAINT chk_once_planned CHECK (
    (recurrence = 'once' AND date IS NOT NULL AND day_of_month IS NULL)
    OR
    (recurrence = 'monthly')
  )
);

-- İndeksler: Performans ve delta senkronizasyonu
CREATE INDEX IF NOT EXISTS idx_planned_cashflows_user_id 
  ON planned_cashflows(user_id);

CREATE INDEX IF NOT EXISTS idx_planned_cashflows_updated_at 
  ON planned_cashflows(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_planned_cashflows_active 
  ON planned_cashflows(user_id, is_active) 
  WHERE is_deleted = FALSE;

-- Row Level Security (RLS)
ALTER TABLE planned_cashflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own planned cashflows"
  ON planned_cashflows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own planned cashflows"
  ON planned_cashflows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own planned cashflows"
  ON planned_cashflows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own planned cashflows"
  ON planned_cashflows FOR DELETE
  USING (auth.uid() = user_id);

-- Realtime: Tablonun Supabase Realtime (Postgres Changes) yayınına güvenle eklenmesi
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'planned_cashflows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE planned_cashflows;
  END IF;
END $$;
