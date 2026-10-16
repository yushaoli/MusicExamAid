/**
 * WeChat Pay Exam Checkout + Per-Teacher/Per-Grade Pricing & Concession Rate Cards + Withdrawal Routes.
 *
 * - GET   /concessions/rate-cards                   (Get Grade 1-10 pricing & concession matrix for a teacher)
 * - PUT   /concessions/rate-cards                   (Admin sets per-teacher, per-grade exam_fee_fen & concession_fen)
 * - POST  /payments/checkout                        (Parent pays exam fee via WeChat Pay at teacher+grade price)
 * - GET   /concessions/wallet                       (Teacher/Admin views accumulated concessions, rate cards & withdrawals)
 * - PATCH /concessions/:ledger_id/confirm           (Admin confirms & optionally adjusts amount on the fly)
 * - POST  /concessions/withdrawals                  (Teacher requests withdrawal of confirmed balance)
 * - PATCH /concessions/withdrawals/:id/payout       (Admin approves & marks withdrawal paid out)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatRmbYuan } from '@musicexamaid/shared';
import { dispatchWeComAlert } from './integrations';

export async function paymentConcessionRoutes(app: FastifyInstance): Promise<void> {
  // 0. Per-Teacher × Per-Grade Rate Card Schedule (GET & PUT)
  app.get(
    '/concessions/rate-cards',
    async (
      req: FastifyRequest<{ Querystring: { teacher_id?: string } }>,
      reply: FastifyReply,
    ) => {
      const teacherId = req.query?.teacher_id || 'tch_default';
      const schedule = app.store.getTeacherGradeRateSchedule(teacherId).map(r => ({
        ...r,
        fee_yuan: formatRmbYuan(r.feeFen),
        concession_yuan: formatRmbYuan(r.defaultConcessionFen),
      }));
      return reply.code(200).send({
        teacher_id: teacherId,
        grades: schedule,
      });
    },
  );

  app.put(
    '/concessions/rate-cards',
    async (
      req: FastifyRequest<{
        Body: {
          teacher_id?: string;
          level?: string | number;
          exam_fee_fen?: number;
          concession_fen?: number;
          note?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (
        !body.teacher_id ||
        body.level === undefined ||
        body.exam_fee_fen === undefined ||
        body.concession_fen === undefined
      ) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'teacher_id, level, exam_fee_fen, and concession_fen are required',
        });
      }

      const card = app.store.upsertTeacherGradeRateCard({
        teacher_id: body.teacher_id,
        level: body.level,
        exam_fee_fen: Number(body.exam_fee_fen),
        concession_fen: Number(body.concession_fen),
        note: body.note,
      });

      return reply.code(200).send({
        ...card,
        exam_fee_yuan: formatRmbYuan(card.exam_fee_fen),
        concession_yuan: formatRmbYuan(card.concession_fen),
      });
    },
  );

  // 1. Parent WeChat Pay checkout (priced by teacher_id + grade level + optional value-added add-ons)
  app.post(
    '/payments/checkout',
    async (
      req: FastifyRequest<{
        Body: {
          registration_id?: string;
          teacher_id?: string;
          addon_ids?: string[];
          wx_transaction_id?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const body = req.body ?? {};
      if (!body.registration_id) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'registration_id is required',
        });
      }

      const result = app.store.payRegistrationOrder({
        registration_id: body.registration_id,
        teacher_id: body.teacher_id,
        addon_ids: body.addon_ids,
        wx_transaction_id: body.wx_transaction_id,
      });

      return reply.code(201).send({
        order: {
          ...result.order,
          amount_yuan: formatRmbYuan(result.order.amount_fen),
        },
        addon_breakdown: {
          ...result.addon_breakdown,
          base_exam_fee_yuan: formatRmbYuan(result.addon_breakdown.base_exam_fee_fen),
          addons_fee_yuan: formatRmbYuan(result.addon_breakdown.addons_fee_fen),
          total_payable_yuan: formatRmbYuan(result.addon_breakdown.total_payable_fen),
          addons_teacher_bonus_yuan: formatRmbYuan(
            result.addon_breakdown.addons_teacher_bonus_fen,
          ),
          platform_net_addon_profit_yuan: formatRmbYuan(
            result.addon_breakdown.platform_net_addon_profit_fen,
          ),
        },
        concession: result.concession
          ? {
              ...result.concession,
              default_amount_yuan: formatRmbYuan(result.concession.default_amount_fen),
              adjusted_amount_yuan: formatRmbYuan(result.concession.adjusted_amount_fen),
            }
          : null,
      });
    },
  );

  // 2. Teacher / Admin Concession Wallet view
  app.get(
    '/concessions/wallet',
    async (
      req: FastifyRequest<{ Querystring: { teacher_id?: string } }>,
      reply: FastifyReply,
    ) => {
      const teacherId = req.query?.teacher_id || 'tch_default';
      const wallet = app.store.getTeacherConcessionWallet(teacherId);
      const rateSchedule = app.store.getTeacherGradeRateSchedule(teacherId).map(r => ({
        ...r,
        fee_yuan: formatRmbYuan(r.feeFen),
        concession_yuan: formatRmbYuan(r.defaultConcessionFen),
      }));
      return reply.code(200).send({
        teacher_id: teacherId,
        summary: {
          ...wallet.summary,
          accrued_yuan: formatRmbYuan(wallet.summary.accrued_fen),
          available_yuan: formatRmbYuan(wallet.summary.available_fen),
          withdrawing_yuan: formatRmbYuan(wallet.summary.withdrawing_fen),
          paid_out_yuan: formatRmbYuan(wallet.summary.paid_out_fen),
        },
        rate_schedule: rateSchedule,
        ledger: wallet.ledger,
        withdrawals: wallet.withdrawals,
      });
    },
  );

  // 3. Admin confirms and optionally adjusts an accrued teacher concession on the fly
  app.patch(
    '/concessions/:ledger_id/confirm',
    async (
      req: FastifyRequest<{
        Params: { ledger_id: string };
        Body: {
          adjusted_amount_fen?: number;
          adjustment_note?: string;
          confirmed_by?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = req.body ?? {};
        const updated = app.store.confirmAndAdjustConcession({
          ledger_id: req.params.ledger_id,
          adjusted_amount_fen: body.adjusted_amount_fen,
          adjustment_note: body.adjustment_note,
          confirmed_by: body.confirmed_by,
        });
        return reply.code(200).send({
          ...updated,
          default_amount_yuan: formatRmbYuan(updated.default_amount_fen),
          adjusted_amount_yuan: formatRmbYuan(updated.adjusted_amount_fen),
        });
      } catch (err) {
        return reply.code(400).send({
          error: 'CONCESSION_CONFIRM_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // 4. Teacher requests withdrawal of all confirmed concessions
  app.post(
    '/concessions/withdrawals',
    async (
      req: FastifyRequest<{
        Body: {
          teacher_id?: string;
          teacher_note?: string;
          payout_channel?: 'wechat_transfer' | 'bank_transfer';
        };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = req.body ?? {};
        const teacherId = body.teacher_id || 'tch_default';
        const result = app.store.requestTeacherWithdrawal({
          teacher_id: teacherId,
          teacher_note: body.teacher_note,
          payout_channel: body.payout_channel,
        });

        await dispatchWeComAlert(
          [
            `**[考级助手] 老师提现申请待打款**`,
            `> 提现单号: \`${result.withdrawal.id}\``,
            `> 老师ID: \`${teacherId}\``,
            `> 提现笔数: ${result.withdrawal.item_count} 笔已确认报名`,
            `> 提现金额: **${formatRmbYuan(result.withdrawal.total_amount_fen)}**`,
          ].join('\n'),
        );

        return reply.code(201).send({
          withdrawal: {
            ...result.withdrawal,
            total_amount_yuan: formatRmbYuan(result.withdrawal.total_amount_fen),
          },
          items: result.items,
        });
      } catch (err) {
        return reply.code(400).send({
          error: 'WITHDRAWAL_REQUEST_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // 5. Admin approves and marks withdrawal paid out
  app.patch(
    '/concessions/withdrawals/:id/payout',
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { admin_note?: string; payout_ref?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const body = req.body ?? {};
        const paid = app.store.payoutTeacherWithdrawal({
          withdrawal_id: req.params.id,
          admin_note: body.admin_note,
          payout_ref: body.payout_ref,
        });
        return reply.code(200).send({
          ...paid,
          total_amount_yuan: formatRmbYuan(paid.total_amount_fen),
        });
      } catch (err) {
        return reply.code(400).send({
          error: 'WITHDRAWAL_PAYOUT_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
