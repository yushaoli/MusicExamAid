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

export async function officialSyncRoutes(app: FastifyInstance): Promise<void> {
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
        return reply.code(200).send({
          authenticated: true,
          php_sess_id,
          scan_status: 4,
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
}
