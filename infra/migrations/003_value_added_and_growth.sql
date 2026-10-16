-- =============================================================================
-- Migration 003: Value-Added Monetization Catalog, Checkout Order Bumps &
--                Historical Student Upgrade Radar
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS value_added_catalog (
    id                  VARCHAR(64) PRIMARY KEY,
    title_cn            VARCHAR(128) NOT NULL,
    subtitle_cn         TEXT NOT NULL,
    category            VARCHAR(32) NOT NULL,
    price_fen           INTEGER NOT NULL CHECK (price_fen >= 0),
    teacher_share_fen   INTEGER NOT NULL DEFAULT 0 CHECK (teacher_share_fen >= 0),
    platform_profit_fen INTEGER NOT NULL DEFAULT 0 CHECK (platform_profit_fen >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO value_added_catalog (id, title_cn, subtitle_cn, category, price_fen, teacher_share_fen, platform_profit_fen)
VALUES
    ('ai_id_photo',          '✨ AI 考级标准二寸照一键换底精修',                   '自动抠图换标准白/蓝底 + 35×49mm (413×626px) 考级办合规裁剪', 'checkout_bump',       990,    0,  990),
    ('household_ocr_vip',    '📸 户口本/身份证 OCR 自动填表 + 错漏包赔',           '拍照秒识 18 位身份证号与生僻字校验，制证信息错漏免费重办',   'checkout_bump',       660,    0,  660),
    ('music_theory_pack',    '🎧 中国音乐学院《基本乐科/音基》全真冲刺题库',       '配套级别听音、视唱、乐理闯关 + 3 套考前押题全真模考卷',       'pre_exam_service',   2990,  500, 2490),
    ('mock_video_review',    '🎬 考前模拟视频「名师 1对1 预审点评报告」',          '考前上传演奏视频，获资深老师语音批注 + 通过率评估单',         'pre_exam_service',   4900, 2400, 2500),
    ('growth_archive_frame', '🏅 历年考级星光成长档案 + 定制胡桃木证书相框 (包邮)', '生成 1-10 级专属电子喜报海报 + 刻名实木证书装裱框顺丰寄家',   'commemorative_merch', 5800, 800, 3800)
ON CONFLICT (id) DO UPDATE
SET title_cn            = EXCLUDED.title_cn,
    subtitle_cn         = EXCLUDED.subtitle_cn,
    price_fen           = EXCLUDED.price_fen,
    teacher_share_fen   = EXCLUDED.teacher_share_fen,
    platform_profit_fen = EXCLUDED.platform_profit_fen,
    updated_at          = NOW();

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS addon_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS addons_fee_fen INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS addons_teacher_bonus_fen INTEGER NOT NULL DEFAULT 0;

COMMIT;
