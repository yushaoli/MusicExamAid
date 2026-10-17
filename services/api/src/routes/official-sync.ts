/**
 * Official Exam Portal (`https://kjzx002120.kj5.zgyyxykj.com/admins`) Automation &
 * Cross-Channel Registration Consolidation Routes.
 *
 * - POST /official-sync/qr-session    (Fetch live WeChat QR login session + PHPSESSID from kjzx002120)
 * - POST /official-sync/wxauth-poll   (Poll scan status & auto-confirm PHPSESSID session)
 * - POST /official-sync/consolidate   (Merge & deduplicate Official Website + Helper registrations & accrue teacher concessions)
 */

import * as crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OFFICIAL_PORTAL_BASE_URL,
  RegistrationStatus,
  formatRmbYuan,
  parseOfficialAdminLoginHtml,
  consolidateOfficialAndHelperRegistrations,
  type ChannelRegistrationInput,
} from '@musicexamaid/shared';
import { getPostgresPool } from '../store/postgres';
import { minioClient } from '../store/minio';

// Server-side cached official portal session (`PHPSESSID`) so subsequent "Sync" clicks
// reuse the authenticated session without re-prompting WeChat confirmation until expiry.
interface CachedOfficialSession {
  php_sess_id: string;
  wxauth_token: string;
  authenticated_at: string;
}

let cachedOfficialSession: CachedOfficialSession | null = null;

export async function officialSyncRoutes(app: FastifyInstance): Promise<void> {
  // 0. Check whether ubtxiaomi already holds an active authenticated PHPSESSID session
  app.get('/official-sync/session-status', async (_req, reply) => {
    return reply.code(200).send({
      has_active_session: Boolean(cachedOfficialSession),
      session: cachedOfficialSession
        ? {
            php_sess_id_masked: `${cachedOfficialSession.php_sess_id.slice(0, 6)}...`,
            authenticated_at: cachedOfficialSession.authenticated_at,
          }
        : null,
      oauth_mechanism: {
        qr_payload_pattern:
          'https://gzh.zgyyxykj.com/wx_qrcode/?time=<time>&token=<wxauth_token>&sign=<md5>',
        wechat_redirect:
          `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${process.env.KJZX_OFFICIAL_WX_APPID || '<official_wx_appid>'}&redirect_uri=https://gzh.zgyyxykj.com/wx_qrcode/login&response_type=code&scope=snsapi_base#wechat_redirect`,
      },
    });
  });

  // 1. Fetch a live WeChat Scan Login QR code & PHPSESSID from https://kjzx002120.kj5.zgyyxykj.com/admins
  app.post(
    '/official-sync/qr-session',
    async (
      req: FastifyRequest<{ Body?: { mock_html?: string; mock_php_sess_id?: string } }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (body.mock_html) {
        const parsed = parseOfficialAdminLoginHtml(
          body.mock_html,
          body.mock_php_sess_id || 'mock_phpsessid_123',
        );
        return reply.code(200).send(parsed);
      }

      const res = await fetch(`${OFFICIAL_PORTAL_BASE_URL}/admins`, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
      });
      const setCookie = res.headers.get('set-cookie') || '';
      const sessMatch = /PHPSESSID=([^;]+)/i.exec(setCookie);
      const phpSessId = sessMatch?.[1] ?? '';
      const html = await res.text();
      const parsed = parseOfficialAdminLoginHtml(html, phpSessId);
      return reply.code(200).send(parsed);
    },
  );

  // 2. Poll WeChat QR scan status on kjzx002120 and auto-confirm session when scan_status === 4
  app.post(
    '/official-sync/wxauth-poll',
    async (
      req: FastifyRequest<{
        Body: { php_sess_id?: string; wxauth_token?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { php_sess_id, wxauth_token } = req.body ?? {};
      if (!php_sess_id || !wxauth_token) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'php_sess_id and wxauth_token are required',
        });
      }

      const statusRes = await fetch(
        `${OFFICIAL_PORTAL_BASE_URL}/admins/index/get_wxauth_status?token=${encodeURIComponent(wxauth_token)}`,
        {
          method: 'POST',
          headers: {
            Cookie: `PHPSESSID=${php_sess_id}`,
            'X-Requested-With': 'XMLHttpRequest',
          },
        },
      );
      const statusJson = (await statusRes.json()) as {
        error?: number;
        scan_status?: number | string;
        msg?: string;
      };

      if (Number(statusJson.scan_status) === 4) {
        const confirmRes = await fetch(
          `${OFFICIAL_PORTAL_BASE_URL}/admins/index/wxauth_confirm?token=${encodeURIComponent(wxauth_token)}`,
          {
            method: 'POST',
            headers: {
              Cookie: `PHPSESSID=${php_sess_id}`,
              'X-Requested-With': 'XMLHttpRequest',
            },
          },
        );
        const confirmJson = await confirmRes.json();
        cachedOfficialSession = {
          php_sess_id,
          wxauth_token,
          authenticated_at: new Date().toISOString(),
        };
        return reply.code(200).send({
          authenticated: true,
          php_sess_id,
          scan_status: 4,
          session_cached: true,
          confirm: confirmJson,
        });
      }

      return reply.code(200).send({
        authenticated: false,
        php_sess_id,
        scan_status: Number(statusJson.scan_status ?? 0),
        raw: statusJson,
      });
    },
  );

  // 3. Consolidate Official Website registrations + Helper registrations & auto-accrue teacher concessions
  app.post(
    '/official-sync/consolidate',
    async (
      req: FastifyRequest<{
        Body: {
          cycle_id?: string;
          official_registrations?: Array<{
            official_id?: string;
            name_cn: string;
            gender?: '男' | '女';
            dob?: string;
            id_number: string;
            guardian_phone?: string;
            subject_id: string;
            level: number | string;
            teacher_id?: string;
          }>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      const cycleId = body.cycle_id || '2025-summer';
      const officialRaw = body.official_registrations ?? [];

      // Collect existing helper registrations for this cycle
      const helperItems: ChannelRegistrationInput[] = app.store
        .listRegistrations()
        .filter(r => r.cycle_id === cycleId)
        .map(r => {
          const learner = app.store.getLearner(r.learner_id);
          return {
            registration_id: r.id,
            source: 'helper' as const,
            name_cn: learner?.name_cn || '未知考生',
            id_number_or_last4: learner?.id_last4 || '0000',
            cycle_id: r.cycle_id,
            subject_id: r.subject_id,
            level: r.level,
            teacher_id: r.teacher_id || 'tch_default',
          };
        });

      const officialItems: ChannelRegistrationInput[] = officialRaw.map((o, idx) => ({
        registration_id: o.official_id || `off_${idx + 1}`,
        source: 'official_portal' as const,
        name_cn: o.name_cn,
        id_number_or_last4: o.id_number,
        cycle_id: cycleId,
        subject_id: o.subject_id,
        level: o.level,
        teacher_id: o.teacher_id || 'tch_default',
      }));

      const report = consolidateOfficialAndHelperRegistrations(
        helperItems,
        officialItems,
      );

      // For every `official_only` record, automatically ingest into local store as locked + paid
      // so it appears in the master roster AND accrues the teacher's concession!
      const ingestedIds: string[] = [];
      for (const item of report.items) {
        if (item.category === 'official_only') {
          const src = officialRaw.find(
            o =>
              o.name_cn.trim() === item.name_cn &&
              o.id_number.slice(-4).toUpperCase() === item.id_number_or_last4.slice(-4).toUpperCase(),
          );
          if (!src) continue;

          const learner = app.store.createLearner({
            name_cn: src.name_cn,
            gender: src.gender || '女',
            dob: src.dob || '2016-01-01',
            id_type: '身份证',
            id_number: src.id_number,
            guardian_phone: src.guardian_phone || '13800138000',
            has_portrait_photo: true,
          });
          const reg = app.store.createRegistration({
            learner_id: learner.id,
            teacher_id: src.teacher_id || 'tch_default',
            cycle_id: cycleId,
            subject_id: src.subject_id,
            level: Number(src.level) || 1,
          });
          app.store.payRegistrationOrder({
            registration_id: reg.id,
            teacher_id: src.teacher_id || 'tch_default',
            wx_transaction_id: `official_portal_${item.official_registration_id}`,
          });
          app.store.transitionRegistration({
            id: reg.id,
            from_status: RegistrationStatus.DRAFT,
            to_status: RegistrationStatus.SUBMITTED,
          });
          app.store.transitionRegistration({
            id: reg.id,
            from_status: RegistrationStatus.SUBMITTED,
            to_status: RegistrationStatus.LOCKED,
            teacher_notes: `从考级办官方后台 (kjzx002120) 自动同步归集`,
          });
          ingestedIds.push(reg.id);
        }
      }

      return reply.code(200).send({
        ...report,
        ingested_official_registration_ids: ingestedIds,
      });
    },
  );

  // 4. Live Remote Pull using authenticated PHPSESSID (`POST /official-sync/pull-remote`)
  app.post(
    '/official-sync/pull-remote',
    async (
      req: FastifyRequest<{
        Body?: {
          php_sess_id?: string;
          table_url?: string;
          cycle_id?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      const sessId = body.php_sess_id || cachedOfficialSession?.php_sess_id;
      if (!sessId) {
        return reply.code(400).send({
          error: 'NO_ACTIVE_SESSION',
          message: '请先点击「获取官网登录二维码」并用微信扫码确认，或传入已登录的 php_sess_id',
        });
      }

      const headers = {
        Cookie: `PHPSESSID=${sessId}`,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      };

      const manageRes = await fetch(`${OFFICIAL_PORTAL_BASE_URL}/admins/manage?is_agent=0`, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
      const manageHtml = await manageRes.text();

      // Extract all internal /admins/... menu links
      const menuLinks = Array.from(
        new Set(
          Array.from(manageHtml.matchAll(/href=["'](\/admins\/[^"']+)["']/gi)).map(m => m[1]),
        ),
      ).filter(u => !u.includes('logout') && !u.includes('login'));

      // Extract any bootstrapTable AJAX URLs on manage page or first 5 menu pages
      const tableUrls = new Set<string>();
      const extractTableUrls = (html: string) => {
        for (const m of html.matchAll(/(?:data-url|url)\s*[:=]\s*["'](\/admins\/[^"']+)["']/gi)) {
          if (!m[1].includes('get_wxauth') && !m[1].includes('pwd_login')) {
            tableUrls.add(m[1]);
          }
        }
      };
      extractTableUrls(manageHtml);

      if (body.table_url) {
        tableUrls.add(body.table_url);
      }

      for (const link of menuLinks.slice(0, 6)) {
        try {
          const subRes = await fetch(
            link.startsWith('http') ? link : `${OFFICIAL_PORTAL_BASE_URL}${link}`,
            { method: 'GET', headers },
          );
          const subHtml = await subRes.text();
          extractTableUrls(subHtml);
        } catch {
          // ignore individual subpage errors
        }
      }

      const pulledTables: Array<{ url: string; row_count: number; sample: unknown[] }> = [];
      const discoveredRows: Array<Record<string, unknown>> = [];

      for (const tUrl of tableUrls) {
        try {
          const fullUrl = tUrl.startsWith('http') ? tUrl : `${OFFICIAL_PORTAL_BASE_URL}${tUrl}`;
          const sep = fullUrl.includes('?') ? '&' : '?';
          const ajaxRes = await fetch(
            `${fullUrl}${sep}limit=10000&offset=0&pageSize=10000&pageNumber=1`,
            {
              method: 'GET',
              headers: {
                ...headers,
                'X-Requested-With': 'XMLHttpRequest',
              },
            },
          );
          const text = await ajaxRes.text();
          const json = JSON.parse(text) as {
            rows?: Array<Record<string, unknown>>;
            data?: Array<Record<string, unknown>> | { rows?: Array<Record<string, unknown>> };
          };
          const rows = Array.isArray(json.rows)
            ? json.rows
            : Array.isArray(json.data)
              ? json.data
              : Array.isArray(json.data?.rows)
                ? json.data.rows
                : [];
          if (rows.length > 0) {
            pulledTables.push({
              url: tUrl,
              row_count: rows.length,
              sample: rows.slice(0, 3),
            });
            discoveredRows.push(...rows);
          }
        } catch {
          // ignore non-JSON endpoints
        }
      }

      return reply.code(200).send({
        authenticated_session_check: manageRes.status === 200 && menuLinks.length > 0,
        manage_http_status: manageRes.status,
        discovered_menu_links: menuLinks,
        discovered_table_urls: Array.from(tableUrls),
        pulled_tables: pulledTables,
        total_rows_pulled: discoveredRows.length,
      });
    },
  );

  // 5. Query Live PostgreSQL Archive Summary (`GET /official-sync/archive-stats`)
  app.get('/official-sync/archive-stats', async (_req, reply) => {
    const pool = getPostgresPool();
    const [
      countsRes,
      seasonsRes,
      topAgentsRes,
      topMajorsRes,
      levelsRes,
    ] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM kjzx_partner_agents) AS partner_agents_count,
          (SELECT COUNT(*)::int FROM kjzx_historical_students) AS historical_students_count,
          (SELECT COUNT(*)::int FROM kjzx_historical_exams) AS historical_exams_count,
          (SELECT COUNT(*)::int FROM kjzx_official_majors) AS official_majors_count,
          (SELECT COUNT(*)::int FROM kjzx_official_filings) AS official_filings_count
      `),
      pool.query(`
        SELECT season_code, season_label, COUNT(*)::int AS exam_count
        FROM kjzx_historical_exams
        GROUP BY season_code, season_label
        ORDER BY season_code DESC
      `),
      pool.query(`
        SELECT a.agent_id, a.code, a.name, a.manager, a.phone,
               COUNT(e.exam_id)::int AS total_exams,
               COUNT(DISTINCT e.student_id)::int AS distinct_students
        FROM kjzx_partner_agents a
        LEFT JOIN kjzx_historical_exams e ON e.agent_id = a.agent_id
        GROUP BY a.agent_id, a.code, a.name, a.manager, a.phone
        ORDER BY total_exams DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT major_name, COUNT(*)::int AS exam_count
        FROM kjzx_historical_exams
        GROUP BY major_name
        ORDER BY exam_count DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT level_id, level_name, official_price_yuan, official_price_fen, default_concession_fen
        FROM kjzx_official_levels
        ORDER BY level_id ASC
      `),
    ]);

    return reply.code(200).send({
      totals: countsRes.rows[0],
      seasons: seasonsRes.rows,
      top_partner_agents: topAgentsRes.rows,
      top_majors: topMajorsRes.rows,
      official_levels: levelsRes.rows,
    });
  });

  // 6. Query Live Multi-Year Historical Upgrade Radar from PostgreSQL (`GET /official-sync/archive-upgrade-radar`)
  app.get(
    '/official-sync/archive-upgrade-radar',
    async (
      req: FastifyRequest<{
        Querystring: { agent_id?: string; limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const agentFilter = req.query?.agent_id ? Number(req.query.agent_id) : null;
      const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);

      // Find students whose latest 2025 exam (20254 or 20255) is level < 10 and who have NOT
      // registered in 2026 (20264 or 20265) for the same major_name.
      const summarySql = `
        WITH latest_2025 AS (
          SELECT DISTINCT ON (student_id, major_name)
            student_id, student_name, parent_phone, agent_id, agent_name,
            major_name, level AS last_level, season_label AS last_season
          FROM kjzx_historical_exams
          WHERE season_code IN (20254, 20255)
            AND level < 10
            AND ($1::int IS NULL OR agent_id = $1::int)
          ORDER BY student_id, major_name, level DESC, season_code DESC
        ),
        registered_2026 AS (
          SELECT DISTINCT student_id, major_name
          FROM kjzx_historical_exams
          WHERE season_code IN (20264, 20265)
        ),
        candidates AS (
          SELECT
            l.student_id,
            l.student_name,
            l.parent_phone,
            l.agent_id,
            l.agent_name,
            l.major_name,
            l.last_level,
            l.last_season,
            (l.last_level + 1) AS recommended_level,
            COALESCE(ol.official_price_fen, 36000) AS expected_exam_fee_fen,
            COALESCE(ol.default_concession_fen, 5000) AS expected_concession_fen
          FROM latest_2025 l
          LEFT JOIN registered_2026 r
            ON r.student_id = l.student_id AND r.major_name = l.major_name
          LEFT JOIN kjzx_official_levels ol
            ON ol.level_id = (l.last_level + 1)
          WHERE r.student_id IS NULL
        )
        SELECT
          COUNT(*)::int AS total_candidates,
          COALESCE(SUM(expected_exam_fee_fen), 0)::bigint AS total_expected_exam_fee_fen,
          COALESCE(SUM(expected_concession_fen), 0)::bigint AS total_expected_concession_fen
        FROM candidates
      `;

      const listSql = `
        WITH latest_2025 AS (
          SELECT DISTINCT ON (student_id, major_name)
            student_id, student_name, parent_phone, agent_id, agent_name,
            major_name, level AS last_level, season_label AS last_season
          FROM kjzx_historical_exams
          WHERE season_code IN (20254, 20255)
            AND level < 10
            AND ($1::int IS NULL OR agent_id = $1::int)
          ORDER BY student_id, major_name, level DESC, season_code DESC
        ),
        registered_2026 AS (
          SELECT DISTINCT student_id, major_name
          FROM kjzx_historical_exams
          WHERE season_code IN (20264, 20265)
        )
        SELECT
          l.student_id,
          l.student_name,
          l.parent_phone,
          l.agent_id,
          l.agent_name,
          l.major_name,
          l.last_level,
          l.last_season,
          (l.last_level + 1) AS recommended_level,
          COALESCE(ol.official_price_yuan, 360) AS expected_exam_fee_yuan,
          COALESCE(ol.official_price_fen, 36000) AS expected_exam_fee_fen,
          COALESCE(ol.default_concession_fen, 5000) AS expected_concession_fen
        FROM latest_2025 l
        LEFT JOIN registered_2026 r
          ON r.student_id = l.student_id AND r.major_name = l.major_name
        LEFT JOIN kjzx_official_levels ol
          ON ol.level_id = (l.last_level + 1)
        WHERE r.student_id IS NULL
        ORDER BY l.last_level DESC, l.student_id DESC
        LIMIT $2::int
      `;

      const [sumRes, listRes] = await Promise.all([
        pool.query(summarySql, [agentFilter]),
        pool.query(listSql, [agentFilter, limit]),
      ]);

      const summary = sumRes.rows[0] || {
        total_candidates: 0,
        total_expected_exam_fee_fen: 0,
        total_expected_concession_fen: 0,
      };
      const totalFeeFen = Number(summary.total_expected_exam_fee_fen || 0);
      const totalConcFen = Number(summary.total_expected_concession_fen || 0);

      return reply.code(200).send({
        target_season: '2026考期 (未报名续报升班雷达)',
        total_candidates: Number(summary.total_candidates || 0),
        total_expected_exam_fee_fen: totalFeeFen,
        total_expected_exam_fee_yuan: formatRmbYuan(totalFeeFen),
        total_expected_concession_fen: totalConcFen,
        total_expected_concession_yuan: formatRmbYuan(totalConcFen),
        sample_candidates: listRes.rows.map(r => ({
          ...r,
          expected_concession_yuan: formatRmbYuan(Number(r.expected_concession_fen || 0)),
          wechat_template_preview: `【中国音乐学院考级升班提醒】${r.student_name}家长您好，孩子在${r.last_season}已顺利完成「${r.major_name} ${r.last_level}级」，本季可直升「${r.major_name} ${r.recommended_level}级」（报名费 ¥${r.expected_exam_fee_yuan}）。点击小程序一键复用历史档案免填表报名（指导老师：${r.agent_name || '本机构'}）。`,
        })),
      });
    },
  );

  // 7. List all Partner Teachers/Agents with invite_token, parent_referral_code & WeChat binding status (`GET /official-sync/partner-agents`)
  app.get('/official-sync/partner-agents', async (_req, reply) => {
    const pool = getPostgresPool();
    const { rows } = await pool.query(`
      SELECT
        a.agent_id,
        a.code,
        a.name,
        a.manager,
        a.phone,
        a.addr,
        a.invite_token,
        a.parent_referral_code,
        a.wx_openid,
        a.wx_nickname,
        a.bound_at,
        COUNT(e.exam_id)::int AS total_exams,
        COUNT(DISTINCT e.student_id)::int AS distinct_students
      FROM kjzx_partner_agents a
      LEFT JOIN kjzx_historical_exams e ON e.agent_id = a.agent_id
      GROUP BY a.agent_id, a.code, a.name, a.manager, a.phone, a.addr, a.invite_token, a.parent_referral_code, a.wx_openid, a.wx_nickname, a.bound_at
      ORDER BY (CASE WHEN a.agent_id = 999 THEN 0 ELSE 1 END) ASC, total_exams DESC, a.agent_id ASC
    `);
    return reply.code(200).send({
      total: rows.length,
      items: rows,
    });
  });

  // 8. Historical Student Lookup & 1-Click Renewal Profile (`GET /official-sync/student-lookup`)
  app.get(
    '/official-sync/student-lookup',
    async (
      req: FastifyRequest<{
        Querystring: { q?: string; agent_id?: string; limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const q = (req.query?.q || '').trim();
      const agentId = req.query?.agent_id ? Number(req.query.agent_id) : null;
      const limit = Math.min(Math.max(Number(req.query?.limit || 12), 1), 50);

      const studentsRes = await pool.query(
        `
        SELECT
          s.student_id,
          s.name_cn,
          s.pinyin,
          s.sex,
          s.nation,
          s.birthday,
          s.id_card_masked,
          s.parent_phone_masked,
          s.agent_id,
          s.agent_name,
          s.picture_url,
          s.id_picture_url,
          s.all_exams
        FROM kjzx_historical_students s
        WHERE ($1::text = '' OR s.name_cn ILIKE '%' || $1 || '%' OR s.pinyin ILIKE '%' || $1 || '%' OR s.parent_phone_masked ILIKE '%' || $1 || '%' OR s.id_card_masked ILIKE '%' || $1 || '%')
          AND ($2::int IS NULL OR s.agent_id = $2::int)
        ORDER BY (CASE WHEN s.agent_id = 999 THEN 0 ELSE 1 END) ASC, s.all_exams DESC, s.student_id DESC
        LIMIT $3::int
        `,
        [q, agentId, limit],
      );

      const studentIds = studentsRes.rows.map(r => r.student_id);
      let examsByStudent = new Map<number, Array<Record<string, unknown>>>();

      if (studentIds.length > 0) {
        const examsRes = await pool.query(
          `
          SELECT
            e.exam_id,
            e.student_id,
            e.season_code,
            e.season_label,
            e.major_id,
            e.major_name,
            e.level,
            e.pass_level,
            e.exam_no,
            e.cert_no,
            e.exam_titles,
            e.certs_json,
            e.videos_json,
            e.score_total,
            e.score_yinzhun,
            e.score_jiezou,
            e.score_yinse,
            e.score_biaoxianli,
            e.score_wanzhengxing,
            e.review_text,
            e.self_review_text,
            e.review_teacher_name,
            e.status,
            e.is_pay,
            e.filing_code,
            e.agent_id,
            e.agent_name,
            COALESCE(ol.official_price_yuan, 360) AS next_level_fee_yuan
          FROM kjzx_historical_exams e
          LEFT JOIN kjzx_official_levels ol ON ol.level_id = LEAST(e.level + 1, 11)
          WHERE e.student_id = ANY($1::int[])
          ORDER BY e.season_code DESC, e.level DESC
          `,
          [studentIds],
        );

        for (const row of examsRes.rows) {
          const sid = Number(row.student_id);
          const list = examsByStudent.get(sid) || [];
          list.push(row);
          examsByStudent.set(sid, list);
        }
      }

      const items = studentsRes.rows.map(s => {
        const exams = examsByStudent.get(Number(s.student_id)) || [];
        const instExams = exams.filter(
          e => !String(e.major_name || '').includes('音乐基础') && !String(e.major_name || '').includes('音基'),
        );
        const theoryExams = exams.filter(
          e => String(e.major_name || '').includes('音乐基础') || String(e.major_name || '').includes('音基'),
        );
        const latestInstExam = instExams[0] || exams[0] || null;
        const nextLevel = latestInstExam ? Math.min(Number(latestInstExam.level) + 1, 10) : 1;
        const maxInstLevel = instExams.reduce((mx, e) => Math.max(mx, Number(e.level || 0)), 0);
        const maxTheoryLevel = theoryExams.reduce((mx, e) => Math.max(mx, Number(e.level || 0)), 0);
        const missingMusicTheory = maxInstLevel >= 2 && maxTheoryLevel === 0;
        const recommendedTheoryLevel = maxInstLevel >= 6 ? 2 : 1;

        return {
          ...s,
          latest_exam: latestInstExam,
          missing_music_theory: missingMusicTheory,
          max_theory_level: maxTheoryLevel,
          recommended_theory_level: recommendedTheoryLevel,
          recommended_upgrade: latestInstExam
            ? {
                major_name: latestInstExam.major_name,
                last_level: Number(latestInstExam.level),
                last_season: latestInstExam.season_label,
                recommended_level: nextLevel,
                official_fee_yuan: Number(latestInstExam.next_level_fee_yuan || 360),
                missing_music_theory: missingMusicTheory,
                recommended_theory_level: recommendedTheoryLevel,
              }
            : null,
          exams,
        };
      });

      return reply.code(200).send({
        query: q,
        count: items.length,
        items,
      });
    },
  );

  // 8b. Studio Growth & Churn Forensic Intelligence (`GET /official-sync/studio-growth-intelligence`)
  app.get('/official-sync/studio-growth-intelligence', async (_req, reply) => {
    const pool = getPostgresPool();
    const [studiosRes, theoryGapRes] = await Promise.all([
      pool.query(`
        WITH studio_stats AS (
          SELECT
            e.agent_id,
            COALESCE(a.code, e.agent_id::text) AS code,
            COALESCE(a.name, e.agent_name) AS name,
            a.manager,
            a.invite_token,
            a.parent_referral_code,
            MODE() WITHIN GROUP (ORDER BY CASE WHEN e.major_name <> '音乐基础知识' THEN e.major_name ELSE NULL END) AS main_inst,
            COUNT(*) FILTER (WHERE season_code IN (20224, 20225))::int AS y2022,
            COUNT(*) FILTER (WHERE season_code IN (20234, 20235))::int AS y2023,
            COUNT(*) FILTER (WHERE season_code IN (20244, 20245))::int AS y2024,
            COUNT(*) FILTER (WHERE season_code IN (20254, 20255))::int AS y2025,
            COUNT(*) FILTER (WHERE season_code IN (20264, 20265))::int AS y2026,
            COUNT(DISTINCT e.student_id) FILTER (WHERE season_code IN (20244, 20245) AND level <= 8 AND major_name <> '音乐基础知识')::int AS c2024_eligible,
            COUNT(DISTINCT e.student_id) FILTER (
              WHERE season_code IN (20244, 20245) AND level <= 8 AND major_name <> '音乐基础知识'
              AND EXISTS (
                SELECT 1 FROM kjzx_historical_exams e2
                WHERE e2.student_id = e.student_id AND e2.season_code >= 20254
              )
            )::int AS c2024_returned_25_26,
            ROUND(AVG(level) FILTER (WHERE season_code IN (20224,20225) AND major_name <> '音乐基础知识'), 1)::float AS avg_lvl_22,
            ROUND(AVG(level) FILTER (WHERE season_code IN (20254,20255) AND major_name <> '音乐基础知识'), 1)::float AS avg_lvl_25
          FROM kjzx_historical_exams e
          LEFT JOIN kjzx_partner_agents a ON a.agent_id = e.agent_id
          WHERE e.agent_id IS NOT NULL AND e.agent_id <> 999
          GROUP BY e.agent_id, a.code, a.name, e.agent_name, a.manager, a.invite_token, a.parent_referral_code
        )
        SELECT
          agent_id,
          code,
          name,
          manager,
          invite_token,
          parent_referral_code,
          main_inst,
          y2022, y2023, y2024, y2025, y2026,
          COALESCE(ROUND(c2024_returned_25_26 * 100.0 / NULLIF(c2024_eligible, 0), 0), 0)::int AS ret24_pct,
          avg_lvl_22,
          avg_lvl_25,
          (y2023 - y2025)::int AS lost_since_2023
        FROM studio_stats
        WHERE y2023 >= 45
        ORDER BY (y2023 - y2025) DESC
        LIMIT 18;
      `),
      pool.query(`
        WITH student_majors AS (
          SELECT
            student_id,
            BOOL_OR(major_name LIKE '%音乐基础%' OR major_name LIKE '%音基%') AS has_theory,
            MAX(level) FILTER (WHERE major_name <> '音乐基础知识') AS max_inst_level
          FROM kjzx_historical_exams
          WHERE agent_id IS NULL OR agent_id <> 999
          GROUP BY student_id
        )
        SELECT
          COUNT(*) FILTER (WHERE max_inst_level >= 3 AND NOT has_theory)::int AS grade3plus_missing_theory,
          COUNT(*) FILTER (WHERE max_inst_level >= 6 AND NOT has_theory)::int AS grade6plus_missing_theory
        FROM student_majors;
      `),
    ]);

    const rows = studiosRes.rows;
    const channelDefectors = rows.filter(r => Number(r.ret24_pct) <= 36 && Number(r.lost_since_2023) >= 35);
    const loyalAging = rows.filter(r => Number(r.ret24_pct) > 36 && Number(r.lost_since_2023) >= 35);
    const gap = theoryGapRes.rows[0] || { grade3plus_missing_theory: 2439, grade6plus_missing_theory: 1027 };

    return reply.code(200).send({
      theory_cross_sell_gap: {
        grade3plus_missing_theory: gap.grade3plus_missing_theory,
        grade6plus_missing_theory: gap.grade6plus_missing_theory,
        potential_exam_fee_yuan: gap.grade3plus_missing_theory * 240,
      },
      channel_defectors_bucket_b: channelDefectors,
      loyal_aging_bucket_a: loyalAging,
    });
  });

  // 9. Resolve Role & Locked Partner Teacher Session (`GET /official-sync/resolve-session`)
  app.get(
    '/official-sync/resolve-session',
    async (
      req: FastifyRequest<{
        Querystring: {
          invite_token?: string;
          ref?: string;
          wx_openid?: string;
          role?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const { invite_token, ref, wx_openid, role } = req.query ?? {};

      if (invite_token || wx_openid) {
        const { rows } = await pool.query(
          `
          SELECT agent_id, code, name, manager, phone, addr,
                 invite_token, parent_referral_code, wx_openid, wx_nickname, bound_at
          FROM kjzx_partner_agents
          WHERE ($1::text IS NOT NULL AND invite_token = $1::text)
             OR ($2::text IS NOT NULL AND wx_openid = $2::text)
          LIMIT 1
          `,
          [invite_token || null, wx_openid || null],
        );
        if (rows[0]) {
          return reply.code(200).send({
            role: 'teacher',
            is_isolated: true,
            locked_agent: rows[0],
          });
        }
      }

      if (ref) {
        const numericId = /^\d+$/.test(ref) ? Number(ref) : null;
        const { rows } = await pool.query(
          `
          SELECT agent_id, code, name, manager, phone,
                 parent_referral_code
          FROM kjzx_partner_agents
          WHERE parent_referral_code = $1::text
             OR ($2::int IS NOT NULL AND agent_id = $2::int)
          LIMIT 1
          `,
          [ref, numericId],
        );
        if (rows[0]) {
          return reply.code(200).send({
            role: 'parent',
            is_isolated: true,
            locked_agent: rows[0],
          });
        }
      }

      return reply.code(200).send({
        role: role === 'parent' ? 'parent' : 'admin',
        is_isolated: role === 'parent',
        locked_agent: null,
      });
    },
  );

  // 10. Bind Partner Teacher's WeChat Account (`POST /official-sync/bind-teacher-wechat`)
  app.post(
    '/official-sync/bind-teacher-wechat',
    async (
      req: FastifyRequest<{
        Body: {
          invite_token?: string;
          agent_id?: number;
          wx_openid?: string;
          wx_nickname?: string;
          unbind?: boolean;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const body = req.body ?? {};
      if (!body.invite_token && !body.agent_id) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'invite_token or agent_id is required',
        });
      }

      if (body.unbind) {
        const { rows } = await pool.query(
          `
          UPDATE kjzx_partner_agents
          SET wx_openid = NULL, wx_nickname = NULL, bound_at = NULL
          WHERE ($1::text IS NOT NULL AND invite_token = $1::text)
             OR ($2::int IS NOT NULL AND agent_id = $2::int)
          RETURNING agent_id, code, name, manager, invite_token, parent_referral_code, wx_openid, wx_nickname, bound_at
          `,
          [body.invite_token || null, body.agent_id ?? null],
        );
        return reply.code(200).send({
          bound: false,
          agent: rows[0] || null,
        });
      }

      const wxOpenId = body.wx_openid || `wx_oid_${Date.now().toString(36)}`;
      const wxNickname = body.wx_nickname || '微信实名绑定老师';

      const { rows } = await pool.query(
        `
        UPDATE kjzx_partner_agents
        SET wx_openid = $3::text,
            wx_nickname = $4::text,
            bound_at = NOW()
        WHERE ($1::text IS NOT NULL AND invite_token = $1::text)
           OR ($2::int IS NOT NULL AND agent_id = $2::int)
        RETURNING agent_id, code, name, manager, invite_token, parent_referral_code, wx_openid, wx_nickname, bound_at
        `,
        [body.invite_token || null, body.agent_id ?? null, wxOpenId, wxNickname],
      );

      if (!rows[0]) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Invalid invite_token or agent_id',
        });
      }

      return reply.code(200).send({
        bound: true,
        agent: rows[0],
      });
    },
  );

  // Helper: Read-through buffer from Aliyun OSS / zgyyxykj to local MinIO S3 (`100.64.0.4:9010`)
  const ALLOWED_MEDIA_HOSTS = new Set([
    'tlskkj.oss-cn-hangzhou.aliyuncs.com',
    'v.zgyyxykj.com',
  ]);

  async function bufferRemoteMediaToMinio(
    sourceUrl: string,
    meta?: { student_id?: number | null; exam_id?: number | null; media_type?: string },
  ): Promise<{
    buf: Buffer;
    contentType: string;
    s3Key: string;
    cacheStatus: 'HIT' | 'MISS-BUFFERED';
  }> {
    const parsedUrl = new URL(sourceUrl);
    if (!ALLOWED_MEDIA_HOSTS.has(parsedUrl.hostname)) {
      throw new Error(`Disallowed media host: ${parsedUrl.hostname}`);
    }

    const pool = getPostgresPool();
    const existing = await pool.query(
      `SELECT s3_key, content_type FROM kjzx_media_cache WHERE source_url = $1`,
      [sourceUrl],
    );

    if (existing.rows[0]) {
      const s3Key = String(existing.rows[0].s3_key);
      const cachedBuf = await minioClient.getObject(s3Key);
      if (cachedBuf) {
        await pool.query(
          `UPDATE kjzx_media_cache SET hit_count = hit_count + 1, last_hit_at = NOW() WHERE source_url = $1`,
          [sourceUrl],
        );
        return {
          buf: cachedBuf,
          contentType: String(existing.rows[0].content_type || 'video/mp4'),
          s3Key,
          cacheStatus: 'HIT',
        };
      }
    }

    // Cache Miss: Fetch from remote OSS and store in local MinIO S3 on ubtxiaomi
    const upstreamRes = await fetch(sourceUrl);
    if (!upstreamRes.ok) {
      throw new Error(`Upstream fetch failed: HTTP ${upstreamRes.status}`);
    }
    const arrayBuf = await upstreamRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const ext = parsedUrl.pathname.endsWith('.mp4')
      ? 'mp4'
      : parsedUrl.pathname.endsWith('.png')
        ? 'png'
        : 'jpg';
    const contentType =
      upstreamRes.headers.get('content-type') ||
      (ext === 'mp4' ? 'video/mp4' : 'image/jpeg');
    const mediaType =
      meta?.media_type || (ext === 'mp4' ? 'video' : 'photo');
    const urlHash = crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0, 20);
    const baseName = parsedUrl.pathname.split('/').pop() || `asset.${ext}`;
    const s3Key = `kjzx_cache/${mediaType}/${urlHash}_${baseName}`;

    await minioClient.putObject(s3Key, buf, contentType);
    await pool.query(
      `
      INSERT INTO kjzx_media_cache (source_url, s3_key, media_type, content_type, size_bytes, student_id, exam_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (source_url) DO UPDATE
      SET s3_key       = EXCLUDED.s3_key,
          size_bytes   = EXCLUDED.size_bytes,
          last_hit_at  = NOW(),
          hit_count    = kjzx_media_cache.hit_count + 1
      `,
      [
        sourceUrl,
        s3Key,
        mediaType,
        contentType,
        buf.length,
        meta?.student_id ?? null,
        meta?.exam_id ?? null,
      ],
    );

    return {
      buf,
      contentType,
      s3Key,
      cacheStatus: 'MISS-BUFFERED',
    };
  }

  // 11. Read-Through Video & Photo Proxy with HTTP Range Support (`GET /official-sync/media-proxy`)
  app.get(
    '/official-sync/media-proxy',
    async (
      req: FastifyRequest<{
        Querystring: {
          url?: string;
          student_id?: string;
          exam_id?: string;
          type?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const sourceUrl = (req.query?.url || '').trim();
      if (!sourceUrl) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Query parameter url is required',
        });
      }

      try {
        const { buf, contentType, s3Key, cacheStatus } = await bufferRemoteMediaToMinio(
          sourceUrl,
          {
            student_id: req.query?.student_id ? Number(req.query.student_id) : null,
            exam_id: req.query?.exam_id ? Number(req.query.exam_id) : null,
            media_type: req.query?.type,
          },
        );

        reply.header('X-Media-Cache', cacheStatus);
        reply.header('X-Minio-S3-Key', s3Key);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Type', contentType);

        const rangeHeader = req.headers.range;
        if (rangeHeader && rangeHeader.startsWith('bytes=')) {
          const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
          const start = Math.max(0, parseInt(startStr, 10) || 0);
          const end = endStr
            ? Math.min(buf.length - 1, parseInt(endStr, 10))
            : buf.length - 1;
          const chunk = buf.subarray(start, end + 1);
          reply.header('Content-Range', `bytes ${start}-${end}/${buf.length}`);
          reply.header('Content-Length', String(chunk.length));
          return reply.code(206).send(chunk);
        }

        reply.header('Content-Length', String(buf.length));
        return reply.code(200).send(buf);
      } catch (err) {
        return reply.code(502).send({
          error: 'MEDIA_PROXY_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // 12. Query Local MinIO S3 Media Cache Statistics (`GET /official-sync/media-cache-stats`)
  app.get('/official-sync/media-cache-stats', async (_req, reply) => {
    const pool = getPostgresPool();
    const [summaryRes, recentRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_cached_files,
          COUNT(*) FILTER (WHERE media_type = 'video')::int AS cached_videos,
          COUNT(*) FILTER (WHERE media_type != 'video')::int AS cached_photos,
          COALESCE(SUM(size_bytes), 0)::bigint AS total_size_bytes,
          COALESCE(SUM(hit_count), 0)::int AS total_hits
        FROM kjzx_media_cache
      `),
      pool.query(`
        SELECT source_url, s3_key, media_type, content_type, size_bytes, student_id, exam_id, hit_count, cached_at
        FROM kjzx_media_cache
        ORDER BY last_hit_at DESC
        LIMIT 15
      `),
    ]);

    const summary = summaryRes.rows[0] || {};
    const totalBytes = Number(summary.total_size_bytes || 0);
    return reply.code(200).send({
      total_cached_files: Number(summary.total_cached_files || 0),
      cached_videos: Number(summary.cached_videos || 0),
      cached_photos: Number(summary.cached_photos || 0),
      total_size_bytes: totalBytes,
      total_size_mb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      total_hits: Number(summary.total_hits || 0),
      recent_items: recentRes.rows,
    });
  });

  // 13. Batch Pre-Buffer Student Videos & Photos into Local MinIO S3 (`POST /official-sync/media-prebuffer`)
  app.post(
    '/official-sync/media-prebuffer',
    async (
      req: FastifyRequest<{
        Body?: {
          student_id?: number;
          exam_id?: number;
          agent_id?: number;
          season_code?: number;
          include_videos?: boolean;
          limit?: number;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const body = req.body ?? {};
      const includeVideos = body.include_videos ?? true;
      const limit = Math.min(Math.max(Number(body.limit || 6), 1), 30);

      const { rows } = await pool.query(
        `
        SELECT e.exam_id, e.student_id, e.student_name, e.major_name, e.level, e.season_label,
               e.videos_json, s.picture_url
        FROM kjzx_historical_exams e
        LEFT JOIN kjzx_historical_students s ON s.student_id = e.student_id
        WHERE ($1::int IS NULL OR e.student_id = $1::int)
          AND ($2::int IS NULL OR e.exam_id = $2::int)
          AND ($3::int IS NULL OR e.agent_id = $3::int)
          AND ($4::int IS NULL OR e.season_code = $4::int)
          AND (e.videos_json != '{}'::jsonb OR s.picture_url IS NOT NULL)
        ORDER BY e.season_code DESC, e.exam_id DESC
        LIMIT $5::int
        `,
        [
          body.student_id ?? null,
          body.exam_id ?? null,
          body.agent_id ?? null,
          body.season_code ?? null,
          limit,
        ],
      );

      const results: Array<{
        student_name: string;
        media_type: string;
        title: string;
        s3_key: string;
        size_mb: number;
        cache_status: string;
        proxy_url: string;
      }> = [];

      for (const row of rows) {
        if (row.picture_url && String(row.picture_url).startsWith('http')) {
          try {
            const r = await bufferRemoteMediaToMinio(String(row.picture_url), {
              student_id: Number(row.student_id),
              exam_id: Number(row.exam_id),
              media_type: 'photo',
            });
            results.push({
              student_name: row.student_name,
              media_type: 'photo',
              title: `${row.student_name}-二寸照`,
              s3_key: r.s3Key,
              size_mb: Number((r.buf.length / (1024 * 1024)).toFixed(2)),
              cache_status: r.cacheStatus,
              proxy_url: `/official-sync/media-proxy?url=${encodeURIComponent(String(row.picture_url))}&student_id=${row.student_id}&type=photo`,
            });
          } catch {
            // ignore broken upstream image
          }
        }

        if (includeVideos && row.videos_json && typeof row.videos_json === 'object') {
          const vObj = row.videos_json as Record<string, { url?: string; title?: string }>;
          for (const clip of Object.values(vObj).slice(0, 2)) {
            if (clip?.url && String(clip.url).startsWith('http')) {
              try {
                const r = await bufferRemoteMediaToMinio(String(clip.url), {
                  student_id: Number(row.student_id),
                  exam_id: Number(row.exam_id),
                  media_type: 'video',
                });
                results.push({
                  student_name: row.student_name,
                  media_type: 'video',
                  title: `${row.student_name}-${row.major_name}${row.level}级-${clip.title || '演奏视频'}`,
                  s3_key: r.s3Key,
                  size_mb: Number((r.buf.length / (1024 * 1024)).toFixed(2)),
                  cache_status: r.cacheStatus,
                  proxy_url: `/official-sync/media-proxy?url=${encodeURIComponent(String(clip.url))}&student_id=${row.student_id}&exam_id=${row.exam_id}&type=video`,
                });
              } catch {
                // ignore broken upstream video
              }
            }
          }
        }
      }

      const totalBufferedMb = Number(
        results.reduce((acc, x) => acc + x.size_mb, 0).toFixed(2),
      );

      return reply.code(200).send({
        buffered_count: results.length,
        total_buffered_mb: totalBufferedMb,
        items: results,
      });
    },
  );

  // 14. Use Case 2 (Mom & Wife Daily Tool): Teacher Registration Fee Tally + Pre-Exam Filing Matrix (`GET /official-sync/teacher-fee-and-filing-report`)
  app.get(
    '/official-sync/teacher-fee-and-filing-report',
    async (
      req: FastifyRequest<{
        Querystring: { season_code?: string; agent_q?: string; agent_id?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const seasonCode = Number(req.query?.season_code || 20264);
      const agentQ = (req.query?.agent_q || '').trim();
      const agentId = req.query?.agent_id ? Number(req.query.agent_id) : null;

      const LEVEL_FEE_YUAN: Record<number, number> = {
        1: 200, 2: 240, 3: 280, 4: 320, 5: 360,
        6: 390, 7: 420, 8: 450, 9: 480, 10: 510, 11: 620,
      };

      // 1) Query all exam registrations in the selected season (filtered by teacher/agent if provided)
      const examsRes = await pool.query(
        `
        SELECT
          e.exam_id,
          e.student_id,
          e.student_name,
          e.major_name,
          e.level,
          e.season_code,
          e.season_label,
          e.agent_id,
          COALESCE(e.agent_name, a.name, '未绑定机构') AS agent_name,
          e.certs_json,
          s.picture_url,
          s.id_card_masked,
          s.birthday
        FROM kjzx_historical_exams e
        LEFT JOIN kjzx_partner_agents a ON a.agent_id = e.agent_id
        LEFT JOIN kjzx_historical_students s ON s.student_id = e.student_id
        WHERE e.season_code = $1::int
          AND ($2::int IS NULL OR e.agent_id = $2::int)
          AND ($3::text = '' OR COALESCE(e.agent_name, a.name, '') ILIKE '%' || $3::text || '%' OR COALESCE(a.manager, '') ILIKE '%' || $3::text || '%')
        ORDER BY COALESCE(e.agent_name, a.name, '') ASC,
                 (CASE WHEN e.major_name = '音乐基础知识' THEN 1 ELSE 0 END) ASC,
                 e.major_name ASC,
                 e.level ASC,
                 e.student_name ASC
        `,
        [seasonCode, agentId, agentQ],
      );

      const instByLevel: Record<number, number> = {};
      const theoryByLevel: Record<number, number> = {};
      let totalFeeYuan = 0;
      let instCount = 0;
      let theoryCount = 0;

      const studentRows = examsRes.rows.map((r, idx) => {
        const lvl = Number(r.level || 1);
        const feeYuan = LEVEL_FEE_YUAN[lvl] || 390;
        totalFeeYuan += feeYuan;
        const isTheory = r.major_name === '音乐基础知识';
        if (isTheory) {
          theoryCount += 1;
          theoryByLevel[lvl] = (theoryByLevel[lvl] || 0) + 1;
        } else {
          instCount += 1;
          instByLevel[lvl] = (instByLevel[lvl] || 0) + 1;
        }
        const certs = Array.isArray(r.certs_json) ? r.certs_json : [];
        const cert1 = certs[0] && (certs[0].picture || certs[0].major_name) ? `${certs[0].major_name || ''}${certs[0].level || ''}级` : null;
        const cert2 = certs[1] && (certs[1].picture || certs[1].major_name) ? `${certs[1].major_name || '音基'}${certs[1].level || ''}级` : null;
        return {
          seq: idx + 1,
          exam_id: r.exam_id,
          student_id: r.student_id,
          student_name: r.student_name,
          agent_name: r.agent_name,
          major_name: r.major_name,
          level: lvl,
          fee_yuan: feeYuan,
          has_photo: Boolean(r.picture_url),
          cert1_summary: cert1,
          cert2_summary: cert2,
          needs_cert_check: !isTheory && lvl >= 3 && (!cert1 || !cert2),
        };
      });

      // 2) Full-season Pre-Exam Filing Matrix (`考前备案表 · 专业及考官信息`)
      const filingRes = await pool.query(
        `
        SELECT
          major_name,
          level,
          COUNT(*)::int AS cnt
        FROM kjzx_historical_exams
        WHERE season_code = $1::int
        GROUP BY major_name, level
        ORDER BY (CASE WHEN major_name = '音乐基础知识' THEN 1 ELSE 0 END) ASC,
                 SUM(COUNT(*)) OVER (PARTITION BY major_name) DESC,
                 major_name ASC,
                 level ASC
        `,
        [seasonCode],
      );

      const filingByMajor: Record<
        string,
        { major_name: string; levels: Record<number, number>; total: number }
      > = {};
      let seasonGrandTotal = 0;
      for (const row of filingRes.rows) {
        const m = row.major_name || '其他';
        if (!filingByMajor[m]) {
          filingByMajor[m] = { major_name: m, levels: {}, total: 0 };
        }
        const lv = Number(row.level || 1);
        const c = Number(row.cnt || 0);
        filingByMajor[m].levels[lv] = (filingByMajor[m].levels[lv] || 0) + c;
        filingByMajor[m].total += c;
        seasonGrandTotal += c;
      }

      return reply.code(200).send({
        season_code: seasonCode,
        season_label: examsRes.rows[0]?.season_label || String(seasonCode),
        agent_filter: agentQ || (agentId ? String(agentId) : '全部机构'),
        teacher_summary: {
          total_registrations: studentRows.length,
          instrument_count: instCount,
          theory_count: theoryCount,
          total_fee_yuan: totalFeeYuan,
          instrument_by_level: instByLevel,
          theory_by_level: theoryByLevel,
          students: studentRows,
        },
        filing_table: {
          season_grand_total: seasonGrandTotal,
          majors: Object.values(filingByMajor),
        },
      });
    },
  );

  // 15. Use Case 1 (Mom & Wife Daily Tool): Smart Certificate / Score Screenshot / ID Photo Matcher & Stager (`POST /official-sync/stage-cert-or-photo`)
  app.post(
    '/official-sync/stage-cert-or-photo',
    async (
      req: FastifyRequest<{
        Body?: {
          filename?: string;
          student_name?: string;
          kind?: 'auto' | 'cert' | 'score_screenshot' | 'id_photo';
          major_name?: string;
          level?: string | number;
          issue_date_or_season?: string;
          cert_date_raw?: string;
          school?: string;
          cert_no?: string;
          cert_no_raw?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const pool = getPostgresPool();
      const body = req.body ?? {};
      const rawFilename = (body.filename || '').trim();

      // 1) Parse filename conventions used by Mom & Claude (`熊祉玥_钢琴4级.jpg`, `陈雨馨_成绩查询.jpg`, `詹子妍.jpg`, `刘梓煦_民谣吉他6级.jpg`)
      const baseName = rawFilename.replace(/\.[a-zA-Z0-9]+$/, '').trim();
      const CN_NUM_MAP: Record<string, number> = {
        壹: 1, 一: 1, 贰: 2, 二: 2, 叁: 3, 三: 3, 肆: 4, 四: 4, 伍: 5, 五: 5,
        陆: 6, 六: 6, 柒: 7, 七: 7, 捌: 8, 八: 8, 玖: 9, 九: 9, 拾: 10, 十: 10,
      };

      let inferredName = (body.student_name || '').trim();
      let inferredKind: 'cert' | 'score_screenshot' | 'id_photo' =
        body.kind && body.kind !== 'auto' ? body.kind : 'id_photo';
      let inferredMajor = (body.major_name || '').trim();
      let inferredLevel = body.level ? Number(body.level) : 0;

      if (baseName.includes('_')) {
        const [partName, partDesc] = baseName.split('_', 2);
        if (!inferredName) inferredName = partName.trim();
        if (partDesc.includes('成绩')) {
          inferredKind = 'score_screenshot';
        } else {
          inferredKind = 'cert';
          const lvMatch = partDesc.match(/([0-9]{1,2}|[壹贰叁肆伍陆柒捌玖拾一二三四五六七八九十])级/);
          if (lvMatch && !inferredLevel) {
            inferredLevel = Number(lvMatch[1]) || CN_NUM_MAP[lvMatch[1]] || 0;
          }
          const majorPart = partDesc.replace(/([0-9]{1,2}|[壹贰叁肆伍陆柒捌玖拾一二三四五六七八九十])级.*$/, '').trim();
          if (majorPart && !inferredMajor) {
            inferredMajor = majorPart === '音基' ? '音乐基础知识' : majorPart;
          }
        }
      } else if (!inferredName && /^[\u4e00-\u9fa5]{2,4}$/.test(baseName)) {
        inferredName = baseName;
      }

      const rawCertNo = (body.cert_no || body.cert_no_raw || '').trim();
      if (rawCertNo || body.major_name) {
        if (inferredKind === 'id_photo') inferredKind = 'cert';
      }

      // 2) Derive standard issue date (`暑假` -> `YYYY-10-24`, `寒假` -> `YYYY-04-24` per Integration Spec §5)
      let normalizedDate = (body.issue_date_or_season || body.cert_date_raw || '').trim();
      const seasonMatch = normalizedDate.match(/(20[0-9]{2})年?(暑假|寒假)/);
      if (seasonMatch) {
        normalizedDate = `${seasonMatch[1]}-${seasonMatch[2] === '暑假' ? '10-24' : '04-24'}`;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        normalizedDate = '2025-10-24';
      }

      // 3) Validate 18-digit certificate number (`21...` vs `NO. 120...` per Integration Spec §4 & §6)
      const certNoWarnings: string[] = [];
      if (rawCertNo) {
        if (rawCertNo.startsWith('120')) {
          certNoWarnings.push('⚠️ 您填入的是底部 NO. 印刷流水号 (120开头)，国音后台应填上方 21 开头的 18 位「证书编号」！');
        } else if (!/^21\d{16}$/.test(rawCertNo)) {
          certNoWarnings.push(`⚠️ 证书编号「${rawCertNo}」共 ${rawCertNo.length} 位（标准国音/音乐学院证书编号通常为 21 开头的 18 位数字），请核对原件。`);
        }
      }

      // 4) Search student in PostgreSQL (exact match first; if 0 results, surname + homophone search like `熊祉玥` -> `熊祉钥`)
      let exactRes = await pool.query(
        `
        SELECT s.student_id, s.name_cn, s.pinyin, s.sex, s.birthday, s.id_card_masked, s.picture_url, s.agent_name
        FROM kjzx_historical_students s
        WHERE s.name_cn = $1
        ORDER BY s.student_id DESC
        `,
        [inferredName],
      );

      let homophoneWarning: string | null = null;
      if (exactRes.rows.length === 0 && inferredName.length >= 2) {
        const surname = inferredName.slice(0, 1);
        const givenPrefix = inferredName.slice(1, 2);
        const fuzzyRes = await pool.query(
          `
          SELECT s.student_id, s.name_cn, s.pinyin, s.sex, s.birthday, s.id_card_masked, s.picture_url, s.agent_name
          FROM kjzx_historical_students s
          WHERE s.name_cn LIKE $1
          ORDER BY s.student_id DESC
          LIMIT 6
          `,
          [`${surname}${givenPrefix}%`],
        );
        if (fuzzyRes.rows.length > 0) {
          exactRes = fuzzyRes;
          homophoneWarning = `🔍 库中未找到完全同字的「${inferredName}」，但找到同音/近形考生「${fuzzyRes.rows.map(r => `${r.name_cn}(ID:${r.student_id}, 生日:${r.birthday || '—'})`).join('、')}」（如熊祉玥 vs 熊祉钥），请确认是否同一人！`;
        }
      }

      const matchedNameLabel = exactRes.rows[0]?.name_cn || inferredName;
      const duplicateWarning =
        exactRes.rows.length > 1
          ? `⚠️ 注意：库中有 ${exactRes.rows.length} 个同名「${matchedNameLabel}」账号（${exactRes.rows.map(r => `ID:${r.student_id} · 机构:${r.agent_name || '—'} · 生日:${r.birthday || '—'}`).join(' ｜ ')}），请核对机构与生日后再点确认！`
          : null;

      // Fetch latest exam registrations for matched students
      const studentIds = exactRes.rows.map(r => Number(r.student_id));
      const examsByStudent: Record<number, unknown[]> = {};
      if (studentIds.length > 0) {
        const exRes = await pool.query(
          `
          SELECT exam_id, student_id, season_code, season_label, major_name, level, agent_id, agent_name, certs_json
          FROM kjzx_historical_exams
          WHERE student_id = ANY($1::int[])
          ORDER BY season_code DESC, exam_id DESC
          `,
          [studentIds],
        );
        for (const ex of exRes.rows) {
          const sid = Number(ex.student_id);
          if (!examsByStudent[sid]) examsByStudent[sid] = [];
          examsByStudent[sid].push(ex);
        }
      }

      const isTheoryCert = inferredMajor === '音乐基础知识' || inferredMajor.includes('音基');
      const targetSlot =
        inferredKind === 'id_photo'
          ? '考生列表 → 修改 → 照片 (picture)'
          : isTheoryCert
            ? '报考专业列表 → 证书2 (index=1 · 音乐基础知识证书)'
            : '报考专业列表 → 证书1 (index=0 · 器乐/声乐专业证书)';

      return reply.code(200).send({
        parsed: {
          filename: rawFilename,
          student_name_input: inferredName,
          kind: inferredKind,
          target_slot: targetSlot,
          cert_index: isTheoryCert ? 1 : 0,
          major_name: inferredMajor || (inferredKind === 'id_photo' ? '—' : '钢琴'),
          level: inferredLevel || (inferredKind === 'id_photo' ? null : 4),
          date: normalizedDate,
          school: body.school || '中国音乐学院考级委员会',
          cert_no: rawCertNo,
        },
        warnings: [
          ...(homophoneWarning ? [homophoneWarning] : []),
          ...(duplicateWarning ? [duplicateWarning] : []),
          ...certNoWarnings,
        ],
        matched_students: exactRes.rows.map(s => ({
          ...s,
          picture_proxy_url: s.picture_url
            ? `/official-sync/media-proxy?url=${encodeURIComponent(String(s.picture_url))}&student_id=${s.student_id}&type=photo`
            : null,
          recent_exams: (examsByStudent[Number(s.student_id)] || []).slice(0, 4),
        })),
        official_api_contract:
          inferredKind === 'id_photo'
            ? {
                step1_sts: 'GET https://kjzx002120.kj5.zgyyxykj.com/sts-server/sts.php',
                step2_oss_put: 'PUT https://tlskkj.oss-cn-hangzhou.aliyuncs.com/imgs/<timestamp>.jpg',
                step3_save: 'POST /admins/student/up_img (field: picture — 注意填「照片」而非「证照正面」)',
              }
            : {
                step1_sts: 'GET https://kjzx002120.kj5.zgyyxykj.com/sts-server/sts.php',
                step2_oss_put: 'PUT https://tlskkj.oss-cn-hangzhou.aliyuncs.com/imgs/<timestamp>.jpg',
                step3_save: `POST /admins/exam/modify_cert?index=${isTheoryCert ? 1 : 0} (major_name, level, date=${normalizedDate}, school, no, picture)`,
              },
      });
    },
  );
}

