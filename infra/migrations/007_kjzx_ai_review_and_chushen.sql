-- =============================================================================
-- Migration 007: 5D Adjudicator Scores, Automated 初审 (Compliance Pre-Check),
--                and AI 5D Review Report Persistence for kjzx002120 Exams
-- =============================================================================

BEGIN;

ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_total INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_yinzhun INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_jiezou INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_yinse INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_biaoxianli INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS score_wanzhengxing INTEGER;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS review_text TEXT;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS self_review_text TEXT;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS review_teacher_name VARCHAR(64);
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS is_excellent INTEGER DEFAULT 0;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS is_reject INTEGER DEFAULT 0;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS chushen_status VARCHAR(32);
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS chushen_report_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS video_review_status INTEGER DEFAULT 0;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS no_pass_video_reson TEXT;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS chushen_ai_comment TEXT;
ALTER TABLE kjzx_historical_exams ADD COLUMN IF NOT EXISTS chushen_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kjzx_exams_score_total ON kjzx_historical_exams(score_total);
CREATE INDEX IF NOT EXISTS idx_kjzx_exams_major_level_score ON kjzx_historical_exams(major_name, level, score_total);

COMMIT;
