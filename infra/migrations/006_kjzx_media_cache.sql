-- =============================================================================
-- Migration 006: Local MinIO S3 Media Cache Registry for kjzx002120 Videos,
--                Student 2-Inch Photos, and Historical Certificates
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS kjzx_media_cache (
    source_url   TEXT PRIMARY KEY,
    s3_key       TEXT NOT NULL,
    media_type    VARCHAR(32) NOT NULL DEFAULT 'video', -- 'video' | 'photo' | 'cert'
    content_type VARCHAR(64) NOT NULL DEFAULT 'video/mp4',
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    student_id   INTEGER,
    exam_id      INTEGER,
    hit_count    INTEGER NOT NULL DEFAULT 1,
    cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_hit_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kjzx_media_cache_type ON kjzx_media_cache(media_type);
CREATE INDEX IF NOT EXISTS idx_kjzx_media_cache_student ON kjzx_media_cache(student_id);
CREATE INDEX IF NOT EXISTS idx_kjzx_media_cache_exam ON kjzx_media_cache(exam_id);

COMMIT;
