-- =============================================================================
-- Migration 008: Schema Migrations Ledger, Mom Upload Audit Log Table, and
--                128-bit Unpredictable Partner Teacher Invite Tokens
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kjzx_mom_upload_log (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    operator_name   TEXT NOT NULL DEFAULT '老妈/老婆',
    student_id      INT NOT NULL,
    student_name    TEXT NOT NULL,
    exam_id         INT,
    kind            TEXT NOT NULL,
    target_slot     TEXT NOT NULL,
    major_name      TEXT,
    level           TEXT,
    cert_no         TEXT,
    oss_url         TEXT NOT NULL,
    official_synced BOOLEAN NOT NULL DEFAULT FALSE,
    official_msg    TEXT
);

-- Replace predictable MD5('mea_salt_'...) invite tokens on non-sandbox partner agents
-- with 128-bit unpredictable tokens while preserving the sandbox 999 test token.
UPDATE kjzx_partner_agents
SET invite_token = 't_inv_' || LPAD(agent_id::text, 3, '0') || '_' || SUBSTR(
    MD5(random()::text || clock_timestamp()::text || agent_id::text) ||
    MD5(clock_timestamp()::text || random()::text || COALESCE(code, '')),
    1, 24
)
WHERE agent_id <> 999
  AND (
    invite_token IS NULL
    OR LENGTH(invite_token) < 20
  );

COMMIT;
