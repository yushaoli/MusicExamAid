/**
 * Official Exam Portal (`https://kjzx002120.kj5.zgyyxykj.com/admins`) Automation &
 * Cross-Channel Registration Consolidation Routes.
 *
 * - POST /official-sync/qr-session    (Fetch live WeChat QR login session + PHPSESSID from kjzx002120)
 * - POST /official-sync/wxauth-poll   (Poll scan status & auto-confirm PHPSESSID session)
 * - POST /official-sync/consolidate   (Merge & deduplicate Official Website + Helper registrations & accrue teacher concessions)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OFFICIAL_PORTAL_BASE_URL,
  RegistrationStatus,
  parseOfficialAdminLoginHtml,
  consolidateOfficialAndHelperRegistrations,
  type ChannelRegistrationInput,
} from '@musicexamaid/shared';

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
          'https://open.weixin.qq.com/connect/oauth2/authorize?appid=wxe12eca6f457eafe1&redirect_uri=https://gzh.zgyyxykj.com/wx_qrcode/login&response_type=code&scope=snsapi_base#wechat_redirect',
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
}

