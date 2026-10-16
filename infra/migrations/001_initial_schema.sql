-- 001_initial_schema.sql
-- Initial PostgreSQL schema baseline for MusicExamAid MVP (v2.2.1)

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Dictionaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dict_subjects (
  subject_id   TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  max_level    INTEGER NOT NULL DEFAULT 10,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dict_cycles (
  cycle_id            TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  start_date_optional DATE,
  end_date_optional   DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard subjects
INSERT INTO dict_subjects (subject_id, subject_name, max_level, is_active) VALUES
  ('piano',        '钢琴',         10, TRUE),
  ('violin',       '小提琴',       10, TRUE),
  ('guzheng',      '古筝',         10, TRUE),
  ('erhu',         '二胡',         10, TRUE),
  ('pipa',         '琵琶',         10, TRUE),
  ('flute',        '长笛',         10, TRUE),
  ('clarinet',     '单簧管',       10, TRUE),
  ('saxophone',    '萨克斯',       10, TRUE),
  ('guitar',       '吉他',         10, TRUE),
  ('vocal',        '声乐',         10, TRUE),
  ('music_theory', '音乐基础知识',  3, TRUE)
ON CONFLICT (subject_id) DO NOTHING;

-- Seed standard exam cycles
INSERT INTO dict_cycles (cycle_id, display_name, start_date_optional, end_date_optional) VALUES
  ('2025-spring', '2025年春季考期', '2025-03-01', '2025-05-31'),
  ('2025-summer', '2025年暑期考期', '2025-07-01', '2025-08-31'),
  ('2025-fall',   '2025年秋季考期', '2025-09-01', '2025-11-30'),
  ('2025-winter', '2025年冬季考期', '2025-12-01', '2026-02-28')
ON CONFLICT (cycle_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Identity & Institutions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  openid        TEXT NOT NULL UNIQUE,
  unionid       TEXT UNIQUE,
  mp_openid     TEXT UNIQUE,
  mp_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  wecom_userid  TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'parent' CHECK (role IN ('parent', 'teacher', 'admin', 'super')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL CHECK (channel IN ('wecom', 'wechat_mp')),
  recipient       TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'failed', 'skipped')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS institutions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  legacy_org_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin', 'super')),
  teacher_name   TEXT,
  teacher_phone  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, institution_id, role)
);

CREATE INDEX IF NOT EXISTS idx_teacher_profiles_institution ON teacher_profiles(institution_id);
CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user ON teacher_profiles(user_id);

-- ---------------------------------------------------------------------------
-- 3. Learner Profiles & Enrollments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS learners (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_cn                   TEXT NOT NULL,
  name_en_optional          TEXT NOT NULL DEFAULT '',
  gender                    TEXT NOT NULL CHECK (gender IN ('男', '女')),
  dob                       DATE NOT NULL,
  nationality               TEXT NOT NULL DEFAULT '中国',
  ethnicity_optional        TEXT NOT NULL DEFAULT '',
  id_type                   TEXT NOT NULL,
  id_number_encrypted       TEXT NOT NULL,
  id_last4                  TEXT NOT NULL,
  guardian_phone            TEXT NOT NULL,
  mailing_address_optional  TEXT NOT NULL DEFAULT '',
  recipient_name_optional   TEXT NOT NULL DEFAULT '',
  recipient_phone_optional  TEXT NOT NULL DEFAULT '',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learners_parent_user ON learners(parent_user_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id     UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  consent_status TEXT NOT NULL DEFAULT 'Granted' CHECK (consent_status IN ('Pending', 'Granted', 'Revoked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, institution_id)
);

-- ---------------------------------------------------------------------------
-- 4. Registrations & Status History
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS registrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id            UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  institution_id        UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  cycle_id              TEXT NOT NULL REFERENCES dict_cycles(cycle_id),
  subject_id            TEXT NOT NULL REFERENCES dict_subjects(subject_id),
  level                 INTEGER NOT NULL,
  exam_mode             TEXT NOT NULL DEFAULT '现场' CHECK (exam_mode IN ('现场', '视频', '音基')),
  exam_site_id_optional TEXT NOT NULL DEFAULT '',
  repertoire            JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'needs_change', 'confirmed', 'locked')),
  handoff_status        TEXT NOT NULL DEFAULT 'none'
                        CHECK (handoff_status IN ('none', 'submitted_to_institution', 'included_in_institution_batch', 'included_in_super_batch')),
  teacher_notes         TEXT NOT NULL DEFAULT '',
  snapshot_json         JSONB,
  missing_flags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  locked_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registrations_inst_cycle_status
  ON registrations(institution_id, cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_registrations_learner_cycle
  ON registrations(learner_id, cycle_id);

CREATE TABLE IF NOT EXISTS registration_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_status_history_reg
  ON registration_status_history(registration_id);

-- ---------------------------------------------------------------------------
-- 5. Archive (Exam Records) & Attachments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exam_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id       UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  cycle_id         TEXT REFERENCES dict_cycles(cycle_id),
  subject_id       TEXT NOT NULL REFERENCES dict_subjects(subject_id),
  level            INTEGER NOT NULL,
  result           TEXT NOT NULL DEFAULT '',
  certificate_no   TEXT NOT NULL DEFAULT '',
  issued_date      DATE,
  metadata_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exam_records_learner_cycle
  ON exam_records(learner_id, cycle_id);

CREATE TABLE IF NOT EXISTS attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('learner', 'registration', 'exam_record')),
  owner_id     UUID NOT NULL,
  file_type    TEXT NOT NULL,
  s3_key       TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner
  ON attachments(owner_type, owner_id);

-- ---------------------------------------------------------------------------
-- 6. Export Batches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS export_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        TEXT NOT NULL REFERENCES dict_cycles(cycle_id),
  institution_id  UUID REFERENCES institutions(id) ON DELETE SET NULL,
  batch_type      TEXT NOT NULL DEFAULT 'super' CHECK (batch_type IN ('institution', 'super')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'exported', 'failed')),
  registration_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  s3_export_key   TEXT,
  requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  exported_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
