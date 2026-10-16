-- =============================================================================
-- Migration 004: Official China Conservatory (kjzx002120) 2020-2026 Historical
--                Archive Tables & Official Grade Fee Schedule
-- =============================================================================

BEGIN;

-- 1. Official China Conservatory Grade Fee Schedule (levels 1..10 + 11=演奏级)
CREATE TABLE IF NOT EXISTS kjzx_official_levels (
    level_id                INTEGER PRIMARY KEY,
    level_name              VARCHAR(32) NOT NULL,
    official_price_yuan     INTEGER NOT NULL,
    official_price_fen      INTEGER NOT NULL,
    default_concession_fen  INTEGER NOT NULL DEFAULT 3000,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO kjzx_official_levels (level_id, level_name, official_price_yuan, official_price_fen, default_concession_fen)
VALUES
    (1,  '1级',          200, 20000, 3000),
    (2,  '2级',          240, 24000, 3500),
    (3,  '3级',          280, 28000, 4000),
    (4,  '4级',          320, 32000, 4500),
    (5,  '5级',          360, 36000, 5000),
    (6,  '6级',          390, 39000, 5500),
    (7,  '7级',          420, 42000, 6000),
    (8,  '8级',          450, 45000, 6500),
    (9,  '9级',          480, 48000, 7000),
    (10, '10级',         510, 51000, 8000),
    (11, '11级(演奏级)', 620, 62000, 10000)
ON CONFLICT (level_id) DO UPDATE
SET level_name             = EXCLUDED.level_name,
    official_price_yuan    = EXCLUDED.official_price_yuan,
    official_price_fen     = EXCLUDED.official_price_fen,
    default_concession_fen = EXCLUDED.default_concession_fen,
    updated_at             = NOW();

-- 2. Official 45 China Conservatory Subjects (majors.json)
CREATE TABLE IF NOT EXISTS kjzx_official_majors (
    major_id        INTEGER PRIMARY KEY,
    code            VARCHAR(32),
    name_cn         VARCHAR(64) NOT NULL,
    name_en         VARCHAR(128),
    max_level       INTEGER NOT NULL DEFAULT 10,
    priority        INTEGER NOT NULL DEFAULT 0,
    belong_major_id INTEGER,
    is_delete       INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Official 51 Ministry of Culture Filing Batches (filings.json)
CREATE TABLE IF NOT EXISTS kjzx_official_filings (
    filing_id        INTEGER PRIMARY KEY,
    exam_year_season INTEGER NOT NULL,
    kaoji_name       VARCHAR(128) NOT NULL,
    start_ymd        VARCHAR(32),
    end_ymd          VARCHAR(32),
    company_name     VARCHAR(128),
    credit_code      VARCHAR(64),
    addr             TEXT,
    exam_count       INTEGER NOT NULL DEFAULT 0,
    detail_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Official 200 Partner Agents / Teachers / Studios (agents.json)
CREATE TABLE IF NOT EXISTS kjzx_partner_agents (
    agent_id      INTEGER PRIMARY KEY,
    code          VARCHAR(32),
    name          VARCHAR(128) NOT NULL,
    manager       VARCHAR(64),
    phone         VARCHAR(32),
    addr          TEXT,
    auths_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    create_time   BIGINT,
    update_time   BIGINT,
    raw_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kjzx_partner_agents_name ON kjzx_partner_agents(name);
CREATE INDEX IF NOT EXISTS idx_kjzx_partner_agents_phone ON kjzx_partner_agents(phone);

-- 5. Official 10,376 Historical Student Profiles (students.json)
CREATE TABLE IF NOT EXISTS kjzx_historical_students (
    student_id          INTEGER PRIMARY KEY,
    agent_id            INTEGER,
    agent_name          VARCHAR(128),
    parent_id           INTEGER,
    name_cn             VARCHAR(64) NOT NULL,
    pinyin              VARCHAR(128),
    id_type             INTEGER,
    id_card_masked      VARCHAR(64),
    sex                 VARCHAR(16),
    nation              VARCHAR(32),
    country             VARCHAR(64),
    birthday            VARCHAR(32),
    parent_phone_masked VARCHAR(32),
    picture_url         TEXT,
    id_picture_url      TEXT,
    all_exams           INTEGER NOT NULL DEFAULT 0,
    apply_exams         INTEGER NOT NULL DEFAULT 0,
    create_time         BIGINT,
    update_time         BIGINT,
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kjzx_hist_students_agent ON kjzx_historical_students(agent_id);
CREATE INDEX IF NOT EXISTS idx_kjzx_hist_students_name ON kjzx_historical_students(name_cn);

-- 6. Official 31,939 Historical Exam Registrations 2020-2026 (exams_all.json)
CREATE TABLE IF NOT EXISTS kjzx_historical_exams (
    exam_id          INTEGER PRIMARY KEY,
    season_code      INTEGER NOT NULL,
    season_label     VARCHAR(32) NOT NULL,
    apply_year       INTEGER,
    student_id       INTEGER NOT NULL,
    student_name     VARCHAR(64),
    pinyin           VARCHAR(128),
    sex              VARCHAR(16),
    birthday         VARCHAR(32),
    id_card_masked   VARCHAR(64),
    parent_phone     VARCHAR(32),
    agent_id         INTEGER,
    agent_name       VARCHAR(128),
    teacher_name     VARCHAR(64),
    teacher_phone    VARCHAR(32),
    major_id         INTEGER,
    major_name       VARCHAR(64) NOT NULL,
    level            INTEGER NOT NULL,
    pass_level       INTEGER,
    exam_no          VARCHAR(64),
    cert_no          VARCHAR(64),
    exam_titles      TEXT,
    certs_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
    videos_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           INTEGER NOT NULL DEFAULT 0,
    video_status     INTEGER NOT NULL DEFAULT 0,
    is_pay           INTEGER NOT NULL DEFAULT 0,
    is_made_cert     INTEGER NOT NULL DEFAULT 0,
    filing_id        INTEGER,
    filing_code      VARCHAR(64),
    create_time      BIGINT,
    update_time      BIGINT,
    imported_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kjzx_hist_exams_student ON kjzx_historical_exams(student_id);
CREATE INDEX IF NOT EXISTS idx_kjzx_hist_exams_agent ON kjzx_historical_exams(agent_id);
CREATE INDEX IF NOT EXISTS idx_kjzx_hist_exams_season ON kjzx_historical_exams(season_code);
CREATE INDEX IF NOT EXISTS idx_kjzx_hist_exams_major_level ON kjzx_historical_exams(major_name, level);

COMMIT;
