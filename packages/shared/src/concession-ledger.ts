/**
 * WeChat Pay Exam Fee & Teacher Accumulated Concession / Withdrawal Ledger Engine.
 *
 * Supports **Per-Teacher × Per-Grade (Level 1-10)** differentiated pricing and concession rates:
 * - Both the student exam fee (`exam_fee_fen`) and default teacher concession (`concession_fen`)
 *   depend on `(teacher_id, level)` with fallback to the global grade schedule.
 *
 * Lifecycle:
 * 1. Parent pays exam fee via WeChat Pay (`unpaid` -> `paid`) at the price configured for `(teacher_id, level)`.
 * 2. When registration is `locked`, a ledger entry is accrued (`status = 'accrued'`) with
 *    `default_amount_fen` resolved from `(teacher_id, level)`.
 * 3. Admin reviews accrued concessions, optionally adjusts `adjusted_amount_fen` on the fly,
 *    and confirms (`status = 'confirmed'`).
 * 4. Teacher sees their `available_fen` (sum of `confirmed` entries) and submits a withdrawal
 *    request (`status = 'withdrawing'`, linked to a `TeacherWithdrawalRecord`).
 * 5. Admin approves & pays out the withdrawal (`status = 'paid_out'`).
 */

export type PaymentOrderStatus = 'unpaid' | 'paid' | 'refunded';

export type ConcessionLedgerStatus =
  | 'accrued'      // Pending admin review & adjustment
  | 'confirmed'    // Confirmed by admin -> available for teacher to withdraw
  | 'withdrawing'  // Locked in a pending teacher withdrawal request
  | 'paid_out'     // Disbursed to teacher
  | 'voided';      // Cancelled due to registration refund/unlock

export type WithdrawalStatus = 'requested' | 'approved_paid' | 'rejected';

export interface ExamFeeRule {
  levelNum: number;
  feeFen: number;
  defaultConcessionFen: number;
}

export interface TeacherGradeRateCard {
  teacher_id: string;
  level: string;
  exam_fee_fen: number;
  concession_fen: number;
  note?: string;
  updated_at: string;
}

export interface ResolvedTeacherGradeRate extends ExamFeeRule {
  teacher_id: string;
  level: string;
  source: 'teacher_custom' | 'default_schedule';
  note?: string;
}

export function normalizeLevelKey(level: string | number): string {
  const digits = String(level).replace(/[^\d]/g, '');
  return String(Number(digits) || 1);
}

/**
 * Global fallback graded exam fee & teacher concession schedule (in RMB fen, 100 fen = ¥1.00).
 */
export function getDefaultFeeRuleForLevel(level: string | number): ExamFeeRule {
  const num = Number(normalizeLevelKey(level));
  if (num <= 3) {
    return { levelNum: num, feeFen: 30000, defaultConcessionFen: 3000 }; // Grade 1-3: ¥300 fee, ¥30 concession
  }
  if (num <= 6) {
    return { levelNum: num, feeFen: 48000, defaultConcessionFen: 5000 }; // Grade 4-6: ¥480 fee, ¥50 concession
  }
  if (num <= 8) {
    return { levelNum: num, feeFen: 58000, defaultConcessionFen: 7000 }; // Grade 7-8: ¥580 fee, ¥70 concession
  }
  return { levelNum: num, feeFen: 68000, defaultConcessionFen: 9000 };   // Grade 9-10: ¥680 fee, ¥90 concession
}

/**
 * Resolve both exam fee and default concession for a specific `(teacherId, level)`.
 * Checks teacher-specific rate card first, then `'DEFAULT'` rate card override, then built-in grade schedule.
 */
export function resolveTeacherGradeRate(
  level: string | number,
  teacherId = 'tch_default',
  rateCards: TeacherGradeRateCard[] = [],
): ResolvedTeacherGradeRate {
  const levelKey = normalizeLevelKey(level);
  const levelNum = Number(levelKey);

  const exact = rateCards.find(
    r => r.teacher_id === teacherId && normalizeLevelKey(r.level) === levelKey,
  );
  if (exact) {
    return {
      teacher_id: teacherId,
      level: levelKey,
      levelNum,
      feeFen: exact.exam_fee_fen,
      defaultConcessionFen: exact.concession_fen,
      source: 'teacher_custom',
      note: exact.note,
    };
  }

  const defaultOverride = rateCards.find(
    r => r.teacher_id === 'DEFAULT' && normalizeLevelKey(r.level) === levelKey,
  );
  if (defaultOverride) {
    return {
      teacher_id: teacherId,
      level: levelKey,
      levelNum,
      feeFen: defaultOverride.exam_fee_fen,
      defaultConcessionFen: defaultOverride.concession_fen,
      source: 'default_schedule',
      note: defaultOverride.note,
    };
  }

  const base = getDefaultFeeRuleForLevel(levelKey);
  return {
    teacher_id: teacherId,
    level: levelKey,
    levelNum,
    feeFen: base.feeFen,
    defaultConcessionFen: base.defaultConcessionFen,
    source: 'default_schedule',
  };
}

export interface PaymentOrderRecord {
  id: string;
  registration_id: string;
  learner_id: string;
  teacher_id: string;
  level: string;
  amount_fen: number;
  addon_ids?: string[];
  addons_fee_fen?: number;
  addons_teacher_bonus_fen?: number;
  rate_source: 'teacher_custom' | 'default_schedule';
  status: PaymentOrderStatus;
  wx_transaction_id?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ConcessionLedgerRecord {
  id: string;
  teacher_id: string;
  registration_id: string;
  payment_order_id: string;
  subject_id: string;
  level: string;
  exam_fee_fen: number;
  default_amount_fen: number;
  adjusted_amount_fen: number;
  rate_source: 'teacher_custom' | 'default_schedule';
  adjustment_note?: string;
  status: ConcessionLedgerStatus;
  confirmed_by?: string;
  confirmed_at?: string;
  withdrawal_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TeacherWithdrawalRecord {
  id: string;
  teacher_id: string;
  total_amount_fen: number;
  item_count: number;
  status: WithdrawalStatus;
  teacher_note?: string;
  admin_note?: string;
  payout_channel: 'wechat_transfer' | 'bank_transfer';
  payout_ref?: string;
  requested_at: string;
  paid_at?: string;
}

export interface TeacherWalletSummary {
  teacher_id: string;
  accrued_fen: number;      // Pending admin confirmation
  available_fen: number;    // Confirmed by admin, ready to withdraw
  withdrawing_fen: number;  // In an active withdrawal request
  paid_out_fen: number;     // Historical paid out total
  accrued_count: number;
  available_count: number;
  withdrawing_count: number;
  paid_out_count: number;
}

export function formatRmbYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

export function summarizeTeacherWallet(
  teacherId: string,
  entries: ConcessionLedgerRecord[],
): TeacherWalletSummary {
  const summary: TeacherWalletSummary = {
    teacher_id: teacherId,
    accrued_fen: 0,
    available_fen: 0,
    withdrawing_fen: 0,
    paid_out_fen: 0,
    accrued_count: 0,
    available_count: 0,
    withdrawing_count: 0,
    paid_out_count: 0,
  };

  for (const item of entries) {
    if (item.teacher_id !== teacherId) continue;
    switch (item.status) {
      case 'accrued':
        summary.accrued_fen += item.adjusted_amount_fen;
        summary.accrued_count += 1;
        break;
      case 'confirmed':
        summary.available_fen += item.adjusted_amount_fen;
        summary.available_count += 1;
        break;
      case 'withdrawing':
        summary.withdrawing_fen += item.adjusted_amount_fen;
        summary.withdrawing_count += 1;
        break;
      case 'paid_out':
        summary.paid_out_fen += item.adjusted_amount_fen;
        summary.paid_out_count += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}
