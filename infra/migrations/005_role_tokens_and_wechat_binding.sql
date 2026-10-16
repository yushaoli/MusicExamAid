-- =============================================================================
-- Migration 005: Role Isolation, Teacher WeChat Binding Tokens, Parent Referral
--                Codes & Sandbox Test Accounts (Admin / Teacher / Parent)
-- =============================================================================

BEGIN;

ALTER TABLE kjzx_partner_agents
    ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64) UNIQUE,
    ADD COLUMN IF NOT EXISTS parent_referral_code VARCHAR(64) UNIQUE,
    ADD COLUMN IF NOT EXISTS wx_openid VARCHAR(128),
    ADD COLUMN IF NOT EXISTS wx_nickname VARCHAR(128),
    ADD COLUMN IF NOT EXISTS bound_at TIMESTAMPTZ;

-- Populate deterministic invite_token and parent_referral_code for all existing 200 agents
UPDATE kjzx_partner_agents
SET invite_token = 't_inv_' || LPAD(agent_id::text, 3, '0') || '_' || SUBSTR(MD5('mea_salt_' || agent_id::text || '_' || COALESCE(code, '')), 1, 8),
    parent_referral_code = 'ref_' || LPAD(agent_id::text, 3, '0')
WHERE invite_token IS NULL;

-- Insert a dedicated Sandbox Test Teacher (agent_id = 999) for safe end-to-end testing
INSERT INTO kjzx_partner_agents (
    agent_id, code, name, manager, phone, addr, auths_json,
    invite_token, parent_referral_code, wx_openid, wx_nickname, bound_at
)
VALUES (
    999,
    '999',
    '【测试专席】小戈尔示范琴行',
    '测试张老师',
    '13800138999',
    '九江市浔阳区柴桑春天考级示范点',
    '["modify","check_manage","review_video"]'::jsonb,
    't_inv_999_testdemo',
    'ref_999',
    NULL,
    NULL,
    NULL
)
ON CONFLICT (agent_id) DO UPDATE
SET name                 = EXCLUDED.name,
    manager              = EXCLUDED.manager,
    invite_token         = EXCLUDED.invite_token,
    parent_referral_code = EXCLUDED.parent_referral_code;

-- Seed 3 sandbox historical students & 2025 exam records under agent_id = 999
INSERT INTO kjzx_historical_students (
    student_id, agent_id, agent_name, name_cn, pinyin, id_type,
    id_card_masked, sex, nation, country, birthday, parent_phone_masked,
    all_exams, apply_exams
)
VALUES
    (99901, 999, '【测试专席】小戈尔示范琴行', '测试陈小乐', 'Ce Shi Chen Xiao Le', 1, '3604**********9901', '女', '汉族', '中国', '20160512', '138****9901', 2, 2),
    (99902, 999, '【测试专席】小戈尔示范琴行', '测试林小琴', 'Ce Shi Lin Xiao Qin', 1, '3604**********9902', '女', '汉族', '中国', '20150820', '138****9902', 1, 1),
    (99903, 999, '【测试专席】小戈尔示范琴行', '测试周小朗', 'Ce Shi Zhou Xiao Lang', 1, '3604**********9903', '男', '汉族', '中国', '20141103', '138****9903', 3, 3)
ON CONFLICT (student_id) DO UPDATE
SET agent_id   = EXCLUDED.agent_id,
    agent_name = EXCLUDED.agent_name,
    name_cn    = EXCLUDED.name_cn;

INSERT INTO kjzx_historical_exams (
    exam_id, season_code, season_label, apply_year, student_id, student_name,
    pinyin, sex, birthday, id_card_masked, parent_phone, agent_id, agent_name,
    teacher_name, teacher_phone, major_id, major_name, level, pass_level,
    exam_no, exam_titles, status, is_pay, filing_code
)
VALUES
    (999001, 20254, '2025暑假', 2025, 99901, '测试陈小乐', 'Ce Shi Chen Xiao Le', '女', '20160512', '3604**********9901', '138****9901', 999, '【测试专席】小戈尔示范琴行', '测试张老师', '13800138999', 2, '钢琴', 5, 5, '12099920250001', '["音阶与琶音","车尔尼练习曲","巴赫小前奏曲","小奏鸣曲"]', 5, 1, '002120-TEST-2025'),
    (999002, 20254, '2025暑假', 2025, 99902, '测试林小琴', 'Ce Shi Lin Xiao Qin', '女', '20150820', '3604**********9902', '138****9902', 999, '【测试专席】小戈尔示范琴行', '测试张老师', '13800138999', 4, '古筝', 7, 7, '12099920250002', '["战台风","丰收锣鼓","春江花月夜","山丹丹开花红艳艳"]', 5, 1, '002120-TEST-2025'),
    (999003, 20255, '2025寒假', 2025, 99903, '测试周小朗', 'Ce Shi Zhou Xiao Lang', '男', '20141103', '3604**********9903', '138****9903', 999, '【测试专席】小戈尔示范琴行', '测试张老师', '13800138999', 6, '小提琴', 8, 8, '12099920250003', '["双音音阶","克莱采尔练习曲","巴赫协奏曲","新疆之春"]', 5, 1, '002120-TEST-2025')
ON CONFLICT (exam_id) DO UPDATE
SET agent_id   = EXCLUDED.agent_id,
    agent_name = EXCLUDED.agent_name,
    level      = EXCLUDED.level;

COMMIT;
