-- Migration 002: WeChat Pay orders + Per-Teacher/Per-Grade Pricing & Concession Rate Cards + Withdrawal Ledger

CREATE TABLE IF NOT EXISTS exam_fee_schedules (
  subject_id              TEXT NOT NULL,
  level                   TEXT NOT NULL,
  fee_fen                 INTEGER NOT NULL CHECK (fee_fen >= 0),
  default_concession_fen  INTEGER NOT NULL CHECK (default_concession_fen >= 0),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_id, level)
);

-- Per-teacher, per-grade (level 1..10) custom exam pricing & teacher concession schedule
CREATE TABLE IF NOT EXISTS teacher_grade_rate_cards (
  teacher_id      TEXT NOT NULL,
  level           TEXT NOT NULL,
  exam_fee_fen    INTEGER NOT NULL CHECK (exam_fee_fen >= 0),
  concession_fen  INTEGER NOT NULL CHECK (concession_fen >= 0),
  note            TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, level)
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id                 TEXT PRIMARY KEY,
  registration_id    TEXT NOT NULL,
  learner_id         TEXT NOT NULL,
  teacher_id         TEXT NOT NULL,
  amount_fen         INTEGER NOT NULL CHECK (amount_fen >= 0),
  status             TEXT NOT NULL DEFAULT 'unpaid',
  wx_transaction_id  TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_reg ON payment_orders(registration_id);

CREATE TABLE IF NOT EXISTS teacher_withdrawals (
  id                TEXT PRIMARY KEY,
  teacher_id        TEXT NOT NULL,
  total_amount_fen  INTEGER NOT NULL CHECK (total_amount_fen > 0),
  item_count        INTEGER NOT NULL CHECK (item_count > 0),
  status            TEXT NOT NULL DEFAULT 'requested',
  teacher_note      TEXT,
  admin_note        TEXT,
  payout_channel    TEXT NOT NULL DEFAULT 'wechat_transfer',
  payout_ref        TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_teacher_withdrawals_teacher ON teacher_withdrawals(teacher_id, status);

CREATE TABLE IF NOT EXISTS teacher_concession_ledger (
  id                   TEXT PRIMARY KEY,
  teacher_id           TEXT NOT NULL,
  registration_id      TEXT NOT NULL UNIQUE,
  payment_order_id     TEXT NOT NULL,
  subject_id           TEXT NOT NULL,
  level                TEXT NOT NULL,
  exam_fee_fen         INTEGER NOT NULL CHECK (exam_fee_fen >= 0),
  default_amount_fen   INTEGER NOT NULL CHECK (default_amount_fen >= 0),
  adjusted_amount_fen  INTEGER NOT NULL CHECK (adjusted_amount_fen >= 0),
  adjustment_note      TEXT,
  status               TEXT NOT NULL DEFAULT 'accrued',
  confirmed_by         TEXT,
  confirmed_at         TIMESTAMPTZ,
  withdrawal_id        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_concession_ledger_teacher ON teacher_concession_ledger(teacher_id, status);
