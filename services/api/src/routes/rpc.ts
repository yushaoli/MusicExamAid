/**
 * Zero-rewrite RPC bridge (`POST /rpc/:action`) for `apps/wechat-mini`.
 *
 * Translates legacy `wx.cloud.callFunction({ name, data })` calls from
 * `miniprogram/utils/api.js` directly onto the Fastify `DomainRepository`,
 * returning `{ success: true, data }` or `{ success: false, error, code }`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RegistrationStatus,
  SUBJECT_NAME_MAP,
  resolveSubjectName,
} from '@musicexamaid/shared';

const SUBJECTS_DICT = Object.entries(SUBJECT_NAME_MAP).map(
  ([subject_id, subject_name]) => ({
    subject_id,
    subject_name,
    max_level: subject_id === 'music_theory' ? 3 : 10,
    is_active: true,
  }),
);

const CYCLES_DICT = [
  {
    cycle_id: '2025-spring',
    display_name: '2025年春季考期',
    start_date_optional: '2025-03-01',
    end_date_optional: '2025-05-31',
  },
  {
    cycle_id: '2025-summer',
    display_name: '2025年暑期考期',
    start_date_optional: '2025-07-01',
    end_date_optional: '2025-08-31',
  },
  {
    cycle_id: '2025-fall',
    display_name: '2025年秋季考期',
    start_date_optional: '2025-09-01',
    end_date_optional: '2025-11-30',
  },
  {
    cycle_id: '2025-winter',
    display_name: '2025年冬季考期',
    start_date_optional: '2025-12-01',
    end_date_optional: '2026-02-28',
  },
];

const DEFAULT_INSTITUTIONS = [
  { _id: 'inst_default', name: '星光音乐艺术中心', legacy_org_id: 'ORG001' },
];

export async function rpcRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/rpc/:action',
    async (
      req: FastifyRequest<{
        Params: { action: string };
        Body: Record<string, unknown>;
      }>,
      reply: FastifyReply,
    ) => {
      const { action } = req.params;
      const payload = (req.body ?? {}) as Record<string, any>;

      try {
        switch (action) {
          case 'authLogin':
            return reply.send({
              success: true,
              data: {
                openid: 'wx_openid_default',
                household_id: 'hh_default',
                roles: ['Parent', 'Teacher', 'Admin', 'Super'],
                classIds: ['inst_default'],
              },
            });

          case 'getDictSubjects':
            return reply.send({ success: true, data: SUBJECTS_DICT });

          case 'getDictCycles':
            return reply.send({ success: true, data: CYCLES_DICT });

          case 'institutionList':
            return reply.send({ success: true, data: DEFAULT_INSTITUTIONS });

          case 'learnerList': {
            const list = app.store.listLearners().map(l => ({
              _id: l.id,
              ...l,
              id_number_encrypted: undefined,
            }));
            return reply.send({ success: true, data: list });
          }

          case 'learnerGet': {
            const id = String(payload.learner_id || '');
            const l = app.store.getLearner(id);
            if (!l) {
              return reply.code(404).send({
                success: false,
                error: 'Learner not found',
                code: 'NOT_FOUND',
              });
            }
            return reply.send({
              success: true,
              data: { _id: l.id, ...l, id_number_encrypted: undefined },
            });
          }

          case 'learnerUpsert': {
            const created = app.store.createLearner({
              id: payload.learner_id ? String(payload.learner_id) : undefined,
              name_cn: String(payload.name_cn || '未命名'),
              name_en_optional: payload.name_en_optional,
              gender: payload.gender === '男' ? '男' : '女',
              dob: String(payload.dob || '2016-01-01'),
              nationality: payload.nationality,
              ethnicity_optional: payload.ethnicity_optional,
              id_type: String(payload.id_type || '身份证'),
              id_number: String(payload.id_number || '110101201601011234'),
              guardian_phone: String(payload.guardian_phone || '13800138000'),
              mailing_address_optional: payload.mailing_address_optional,
              recipient_name_optional: payload.recipient_name_optional,
              recipient_phone_optional: payload.recipient_phone_optional,
            });
            return reply.send({
              success: true,
              data: { _id: created.id, id: created.id, id_last4: created.id_last4 },
            });
          }

          case 'enrollmentCreateOrUpdate':
            return reply.send({
              success: true,
              data: {
                learner_id: payload.learner_id,
                class_id: payload.class_id || 'inst_default',
                consent_status: payload.consent_status || 'Granted',
              },
            });

          case 'registrationCreate': {
            const reg = app.store.createRegistration({
              learner_id: String(payload.learner_id),
              institution_id: String(payload.class_id || 'inst_default'),
              cycle_id: String(payload.cycle_id || '2025-summer'),
              subject_id: String(payload.subject_id || 'piano'),
              level: Number(payload.level || 1),
              exam_mode: payload.exam_mode || '现场',
              exam_site_id_optional: payload.exam_site_id_optional,
              repertoire: Array.isArray(payload.repertoire)
                ? payload.repertoire
                : [],
            });
            return reply.send({
              success: true,
              data: { _id: reg.id, id: reg.id, status: reg.status },
            });
          }

          case 'registrationList':
          case 'teacherRosterList': {
            const items = app.store.listRegistrations().map(r => {
              const learner = app.store.getLearner(r.learner_id);
              return {
                _id: r.id,
                ...r,
                workflow_status: r.status,
                learner_name_cn: learner?.name_cn ?? '',
                subject_name: resolveSubjectName(r.subject_id),
              };
            });
            return reply.send({ success: true, data: items });
          }

          case 'registrationGet':
          case 'teacherRegistrationGetDetail': {
            const id = String(payload.reg_id || payload.id || '');
            const r = app.store.getRegistration(id);
            if (!r) {
              return reply.code(404).send({
                success: false,
                error: 'Registration not found',
                code: 'NOT_FOUND',
              });
            }
            const learner = app.store.getLearner(r.learner_id);
            return reply.send({
              success: true,
              data: {
                _id: r.id,
                ...r,
                workflow_status: r.status,
                subject_name: resolveSubjectName(r.subject_id),
                learner: learner
                  ? { _id: learner.id, ...learner, id_number_encrypted: undefined }
                  : null,
              },
            });
          }

          case 'registrationSubmit': {
            const id = String(payload.reg_id || payload.id || '');
            const updated = app.store.transitionRegistration({
              id,
              to_status: RegistrationStatus.SUBMITTED,
            });
            return reply.send({
              success: true,
              data: { _id: updated.id, status: updated.status },
            });
          }

          case 'teacherRequestChanges': {
            const id = String(payload.reg_id || payload.id || '');
            const updated = app.store.transitionRegistration({
              id,
              to_status: RegistrationStatus.NEEDS_CHANGE,
              teacher_notes: String(payload.teacher_notes || ''),
            });
            return reply.send({
              success: true,
              data: { _id: updated.id, status: updated.status },
            });
          }

          case 'teacherConfirm': {
            const id = String(payload.reg_id || payload.id || '');
            const updated = app.store.transitionRegistration({
              id,
              to_status: RegistrationStatus.CONFIRMED,
            });
            return reply.send({
              success: true,
              data: { _id: updated.id, status: updated.status },
            });
          }

          case 'teacherLock': {
            const id = String(payload.reg_id || payload.id || '');
            const updated = app.store.transitionRegistration({
              id,
              to_status: RegistrationStatus.LOCKED,
            });
            return reply.send({
              success: true,
              data: {
                _id: updated.id,
                status: updated.status,
                missing_flags: updated.missing_flags,
              },
            });
          }

          case 'teacherUnlock': {
            const id = String(payload.reg_id || payload.id || '');
            const updated = app.store.transitionRegistration({
              id,
              to_status: RegistrationStatus.CONFIRMED,
              teacher_notes: String(payload.reason || ''),
            });
            return reply.send({
              success: true,
              data: { _id: updated.id, status: updated.status },
            });
          }

          case 'superBatchExportOnce': {
            const lockedIds = app.store
              .listRegistrations()
              .filter(r => r.status === RegistrationStatus.LOCKED)
              .map(r => r.id);
            const batch = app.store.createExportBatch({
              cycle_id: String(payload.cycle_id || '2025-summer'),
              batch_type: 'super',
              registration_ids: lockedIds,
            });
            const baseUrl = process.env.PUBLIC_BASE_URL || 'https://mea.xgar.com.cn';
            return reply.send({
              success: true,
              data: {
                export_id: batch.job_id,
                record_count: batch.item_count,
                tempFileURL: `${baseUrl}/exports/${batch.job_id}/bundle.zip`,
                csvFileURL: `${baseUrl}/exports/${batch.job_id}/csv`,
              },
            });
          }

          case 'paymentCheckout': {
            const regId = String(payload.reg_id || payload.registration_id || '');
            const res = app.store.payRegistrationOrder({
              registration_id: regId,
              teacher_id: payload.teacher_id ? String(payload.teacher_id) : undefined,
              wx_transaction_id: payload.wx_transaction_id ? String(payload.wx_transaction_id) : undefined,
            });
            return reply.send({ success: true, data: res });
          }

          case 'teacherConcessionWallet': {
            const teacherId = String(payload.teacher_id || 'tch_default');
            const wallet = app.store.getTeacherConcessionWallet(teacherId);
            return reply.send({ success: true, data: wallet });
          }

          case 'adminConfirmConcession': {
            const updated = app.store.confirmAndAdjustConcession({
              ledger_id: String(payload.ledger_id || ''),
              adjusted_amount_fen:
                payload.adjusted_amount_fen !== undefined
                  ? Number(payload.adjusted_amount_fen)
                  : undefined,
              adjustment_note: payload.adjustment_note ? String(payload.adjustment_note) : undefined,
              confirmed_by: payload.confirmed_by ? String(payload.confirmed_by) : 'admin',
            });
            return reply.send({ success: true, data: updated });
          }

          case 'teacherRequestWithdrawal': {
            const res = app.store.requestTeacherWithdrawal({
              teacher_id: String(payload.teacher_id || 'tch_default'),
              teacher_note: payload.teacher_note ? String(payload.teacher_note) : undefined,
              payout_channel: payload.payout_channel === 'bank_transfer' ? 'bank_transfer' : 'wechat_transfer',
            });
            return reply.send({ success: true, data: res });
          }

          case 'adminPayoutWithdrawal': {
            const paid = app.store.payoutTeacherWithdrawal({
              withdrawal_id: String(payload.withdrawal_id || ''),
              admin_note: payload.admin_note ? String(payload.admin_note) : undefined,
              payout_ref: payload.payout_ref ? String(payload.payout_ref) : undefined,
            });
            return reply.send({ success: true, data: paid });
          }

          default:
            return reply.send({
              success: true,
              data: { action, status: 'ok' },
            });
        }
      } catch (err) {
        return reply.code(400).send({
          success: false,
          error: err instanceof Error ? err.message : String(err),
          code: 'RPC_ERROR',
        });
      }
    },
  );
}
