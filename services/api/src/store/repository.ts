/**
 * Domain repository for MusicExamAid entities.
 *
 * Provides deterministic persistence for learners, registrations, status history,
 * attachments, exam archives, and export batches, with AES-256 ID encryption and
 * automatic snapshot generation on `confirmed → locked`.
 */

import * as crypto from 'crypto';
import {
  RegistrationStatus,
  assertTransition,
  encryptIdNumber,
  getIdLast4,
  buildRegistrationSnapshot,
  computeMissingFlags,
  mapSnapshotToExportRow,
  formatPortraitPhotoZipPath,
  normalizeLevelKey,
  resolveTeacherGradeRate,
  summarizeTeacherWallet,
  calculateCheckoutWithAddons,
} from '@musicexamaid/shared';
import type {
  RegistrationStatusType,
  RegistrationSnapshot,
  TeacherGradeRateCard,
  ResolvedTeacherGradeRate,
  PaymentOrderRecord,
  ConcessionLedgerRecord,
  TeacherWithdrawalRecord,
  TeacherWalletSummary,
  CheckoutAddonBreakdown,
} from '@musicexamaid/shared';

export interface StoredLearner {
  id: string;
  name_cn: string;
  name_en_optional: string;
  gender: '男' | '女';
  dob: string;
  nationality: string;
  ethnicity_optional: string;
  id_type: string;
  id_number_encrypted: string;
  id_last4: string;
  guardian_phone: string;
  mailing_address_optional: string;
  recipient_name_optional: string;
  recipient_phone_optional: string;
  has_portrait_photo: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoredRegistration {
  id: string;
  learner_id: string;
  institution_id: string | null;
  teacher_id?: string;
  cycle_id: string;
  subject_id: string;
  level: number;
  exam_mode: '现场' | '视频' | '音基';
  exam_site_id_optional: string;
  repertoire: string[];
  status: RegistrationStatusType;
  teacher_notes: string;
  snapshot_json: RegistrationSnapshot | null;
  missing_flags: string[];
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredStatusHistory {
  id: string;
  registration_id: string;
  from_status: RegistrationStatusType | null;
  to_status: RegistrationStatusType;
  notes: string;
  created_at: string;
}

export interface StoredArchive {
  id: string;
  learner_id: string;
  cycle_id: string | null;
  subject_id: string;
  level: number;
  result: string;
  certificate_no: string;
  created_at: string;
}

export interface StoredExportBatch {
  job_id: string;
  cycle_id: string;
  institution_id: string | null;
  batch_type: 'institution' | 'super';
  registration_ids: string[];
  item_count: number;
  status: 'queued' | 'exported';
  preview_rows: Array<Record<string, string>>;
  photo_paths: string[];
  snapshots: RegistrationSnapshot[];
  queued_at: string;
}

export class DomainRepository {
  private learners = new Map<string, StoredLearner>();
  private portraitPhotos = new Map<string, Buffer>();
  private registrations = new Map<string, StoredRegistration>();
  private statusHistory: StoredStatusHistory[] = [];
  private archives = new Map<string, StoredArchive>();
  private exportBatches = new Map<string, StoredExportBatch>();
  private teacherGradeRateCards = new Map<string, TeacherGradeRateCard>();
  private paymentOrders = new Map<string, PaymentOrderRecord>();
  private concessionLedger = new Map<string, ConcessionLedgerRecord>();
  private teacherWithdrawals = new Map<string, TeacherWithdrawalRecord>();

  /**
   * Upsert a per-teacher, per-grade (level 1..10) exam price + concession schedule entry.
   */
  upsertTeacherGradeRateCard(input: {
    teacher_id: string;
    level: string | number;
    exam_fee_fen: number;
    concession_fen: number;
    note?: string;
  }): TeacherGradeRateCard {
    const levelKey = normalizeLevelKey(input.level);
    const key = `${input.teacher_id}:${levelKey}`;
    const card: TeacherGradeRateCard = {
      teacher_id: input.teacher_id,
      level: levelKey,
      exam_fee_fen: Math.max(0, Math.round(input.exam_fee_fen)),
      concession_fen: Math.max(0, Math.round(input.concession_fen)),
      note: input.note,
      updated_at: new Date().toISOString(),
    };
    this.teacherGradeRateCards.set(key, card);
    return card;
  }

  /**
   * Return the full Grade 1..10 resolved pricing & concession schedule for a specific teacher.
   */
  getTeacherGradeRateSchedule(teacherId = 'tch_default'): ResolvedTeacherGradeRate[] {
    const cards = Array.from(this.teacherGradeRateCards.values());
    const grades: ResolvedTeacherGradeRate[] = [];
    for (let g = 1; g <= 10; g++) {
      grades.push(resolveTeacherGradeRate(g, teacherId, cards));
    }
    return grades;
  }

  createLearner(input: {
    id?: string;
    name_cn: string;
    name_en_optional?: string;
    gender: '男' | '女';
    dob: string;
    nationality?: string;
    ethnicity_optional?: string;
    id_type: string;
    id_number: string;
    guardian_phone: string;
    mailing_address_optional?: string;
    recipient_name_optional?: string;
    recipient_phone_optional?: string;
    has_portrait_photo?: boolean;
  }): StoredLearner {
    const now = new Date().toISOString();
    const id = input.id || `lrn_${crypto.randomUUID()}`;
    const record: StoredLearner = {
      id,
      name_cn: input.name_cn,
      name_en_optional: input.name_en_optional || '',
      gender: input.gender,
      dob: input.dob,
      nationality: input.nationality || '中国',
      ethnicity_optional: input.ethnicity_optional || '',
      id_type: input.id_type,
      id_number_encrypted: encryptIdNumber(input.id_number),
      id_last4: getIdLast4(input.id_number),
      guardian_phone: input.guardian_phone,
      mailing_address_optional: input.mailing_address_optional || '',
      recipient_name_optional: input.recipient_name_optional || '',
      recipient_phone_optional: input.recipient_phone_optional || '',
      has_portrait_photo: input.has_portrait_photo ?? true,
      created_at: now,
      updated_at: now,
    };
    this.learners.set(id, record);
    return record;
  }

  getLearner(id: string): StoredLearner | undefined {
    return this.learners.get(id);
  }

  listLearners(): StoredLearner[] {
    return Array.from(this.learners.values());
  }

  setLearnerPhoto(learnerId: string, photoBuffer: Buffer): StoredLearner | undefined {
    const learner = this.learners.get(learnerId);
    if (!learner) return undefined;
    learner.has_portrait_photo = true;
    learner.updated_at = new Date().toISOString();
    this.portraitPhotos.set(learner.id_last4, photoBuffer);
    return learner;
  }

  getPortraitPhotosByLast4(): Record<string, Buffer> {
    return Object.fromEntries(this.portraitPhotos.entries());
  }

  createRegistration(input: {
    id?: string;
    learner_id: string;
    institution_id?: string | null;
    teacher_id?: string;
    cycle_id: string;
    subject_id: string;
    level: number;
    exam_mode?: '现场' | '视频' | '音基';
    exam_site_id_optional?: string;
    repertoire?: string[];
  }): StoredRegistration {
    const now = new Date().toISOString();
    const id = input.id || `reg_${crypto.randomUUID()}`;
    const reg: StoredRegistration = {
      id,
      learner_id: input.learner_id,
      institution_id: input.institution_id ?? null,
      teacher_id: input.teacher_id || 'tch_default',
      cycle_id: input.cycle_id,
      subject_id: input.subject_id,
      level: input.level,
      exam_mode: input.exam_mode ?? '现场',
      exam_site_id_optional: input.exam_site_id_optional ?? '',
      repertoire: input.repertoire ?? [],
      status: RegistrationStatus.DRAFT,
      teacher_notes: '',
      snapshot_json: null,
      missing_flags: [],
      locked_at: null,
      created_at: now,
      updated_at: now,
    };
    this.registrations.set(id, reg);
    this.statusHistory.push({
      id: `hst_${crypto.randomUUID()}`,
      registration_id: id,
      from_status: null,
      to_status: RegistrationStatus.DRAFT,
      notes: 'created',
      created_at: now,
    });
    return reg;
  }

  getRegistration(id: string): StoredRegistration | undefined {
    return this.registrations.get(id);
  }

  listRegistrations(): StoredRegistration[] {
    return Array.from(this.registrations.values());
  }

  getStatusHistory(registrationId: string): StoredStatusHistory[] {
    return this.statusHistory.filter(h => h.registration_id === registrationId);
  }

  transitionRegistration(params: {
    id: string;
    from_status?: RegistrationStatusType;
    to_status: RegistrationStatusType;
    teacher_notes?: string;
  }): StoredRegistration {
    const existing = this.registrations.get(params.id);
    const fromStatus = existing
      ? existing.status
      : (params.from_status ?? RegistrationStatus.SUBMITTED);

    assertTransition(fromStatus, params.to_status);

    const now = new Date().toISOString();
    const reg: StoredRegistration = existing ?? {
      id: params.id,
      learner_id: 'lrn_stub',
      institution_id: 'inst_default',
      teacher_id: 'tch_default',
      cycle_id: '2025-summer',
      subject_id: 'piano',
      level: 5,
      exam_mode: '现场',
      exam_site_id_optional: '',
      repertoire: ['练习曲', '奏鸣曲'],
      status: fromStatus,
      teacher_notes: '',
      snapshot_json: null,
      missing_flags: [],
      locked_at: null,
      created_at: now,
      updated_at: now,
    };

    reg.status = params.to_status;
    if (params.teacher_notes !== undefined) {
      reg.teacher_notes = params.teacher_notes;
    }
    reg.updated_at = now;

    if (params.to_status === RegistrationStatus.LOCKED) {
      const learner =
        this.learners.get(reg.learner_id) ??
        this.createLearner({
          id: reg.learner_id,
          name_cn: '张小琴',
          gender: '女',
          dob: '2016-05-01',
          id_type: '身份证',
          id_number: '110101201605011234',
          guardian_phone: '13800138000',
          has_portrait_photo: true,
        });

      const snapshot = buildRegistrationSnapshot({
        registration: reg,
        learner,
        institution: { legacy_org_id: reg.institution_id || 'ORG001' },
      });
      const flags = computeMissingFlags(snapshot, learner.has_portrait_photo);
      reg.snapshot_json = snapshot;
      reg.missing_flags = flags;
      reg.locked_at = now;
    }

    this.registrations.set(reg.id, reg);
    this.statusHistory.push({
      id: `hst_${crypto.randomUUID()}`,
      registration_id: reg.id,
      from_status: fromStatus,
      to_status: params.to_status,
      notes: params.teacher_notes ?? '',
      created_at: now,
    });

    if (params.to_status === RegistrationStatus.LOCKED) {
      this.ensureConcessionAccrued(reg.id);
    } else if (fromStatus === RegistrationStatus.LOCKED) {
      this.voidConcessionIfUnlocked(reg.id);
    }

    return reg;
  }

  listTeacherGradeRateCards(): TeacherGradeRateCard[] {
    return Array.from(this.teacherGradeRateCards.values());
  }

  /**
   * Create and mark a WeChat Pay order paid for a registration.
   * Both exam fee and teacher concession are resolved by `(teacher_id, level)`,
   * plus optional value-added checkout add-ons (`addon_ids`).
   */
  payRegistrationOrder(input: {
    registration_id: string;
    teacher_id?: string;
    addon_ids?: string[];
    wx_transaction_id?: string;
  }): {
    order: PaymentOrderRecord;
    addon_breakdown: CheckoutAddonBreakdown;
    concession?: ConcessionLedgerRecord;
  } {
    const now = new Date().toISOString();
    const reg = this.registrations.get(input.registration_id);
    const levelStr = String(reg?.level ?? 5);
    const teacherId = input.teacher_id || reg?.teacher_id || 'tch_default';
    if (reg && input.teacher_id) {
      reg.teacher_id = input.teacher_id;
    }

    const rate = resolveTeacherGradeRate(
      levelStr,
      teacherId,
      Array.from(this.teacherGradeRateCards.values()),
    );

    const breakdown = calculateCheckoutWithAddons(
      rate.feeFen,
      rate.defaultConcessionFen,
      input.addon_ids ?? [],
    );

    const existingOrder = Array.from(this.paymentOrders.values()).find(
      o => o.registration_id === input.registration_id,
    );

    const order: PaymentOrderRecord = existingOrder
      ? {
          ...existingOrder,
          teacher_id: teacherId,
          level: rate.level,
          amount_fen: breakdown.total_payable_fen,
          addon_ids: breakdown.selected_addons.map(a => a.id),
          addons_fee_fen: breakdown.addons_fee_fen,
          addons_teacher_bonus_fen: breakdown.addons_teacher_bonus_fen,
          rate_source: rate.source,
          status: 'paid',
          wx_transaction_id: input.wx_transaction_id || existingOrder.wx_transaction_id || `wx_tx_${crypto.randomUUID().slice(0, 12)}`,
          paid_at: now,
          updated_at: now,
        }
      : {
          id: `pay_${crypto.randomUUID()}`,
          registration_id: input.registration_id,
          learner_id: reg?.learner_id || 'lrn_stub',
          teacher_id: teacherId,
          level: rate.level,
          amount_fen: breakdown.total_payable_fen,
          addon_ids: breakdown.selected_addons.map(a => a.id),
          addons_fee_fen: breakdown.addons_fee_fen,
          addons_teacher_bonus_fen: breakdown.addons_teacher_bonus_fen,
          rate_source: rate.source,
          status: 'paid',
          wx_transaction_id: input.wx_transaction_id || `wx_tx_${crypto.randomUUID().slice(0, 12)}`,
          paid_at: now,
          created_at: now,
          updated_at: now,
        };

    this.paymentOrders.set(order.id, order);

    let concession: ConcessionLedgerRecord | undefined;
    if (reg?.status === RegistrationStatus.LOCKED) {
      concession = this.ensureConcessionAccrued(input.registration_id);
    }
    return { order, addon_breakdown: breakdown, concession };
  }

  /**
   * Ensure a teacher concession ledger item is accrued once a registration is LOCKED.
   * Uses the `(teacher_id, level)` rate card plus any teacher revenue share from value-added add-ons.
   */
  ensureConcessionAccrued(registrationId: string): ConcessionLedgerRecord | undefined {
    const reg = this.registrations.get(registrationId);
    if (!reg || reg.status !== RegistrationStatus.LOCKED) return undefined;

    const existing = Array.from(this.concessionLedger.values()).find(
      c => c.registration_id === registrationId,
    );
    if (existing && existing.status !== 'voided') {
      return existing;
    }

    const now = new Date().toISOString();
    const paidOrder = Array.from(this.paymentOrders.values()).find(
      o => o.registration_id === registrationId && o.status === 'paid',
    );
    const teacherId = paidOrder?.teacher_id || reg.teacher_id || 'tch_default';
    const rate = resolveTeacherGradeRate(
      reg.level,
      teacherId,
      Array.from(this.teacherGradeRateCards.values()),
    );

    const addonBonusFen = paidOrder?.addons_teacher_bonus_fen ?? 0;
    const totalDefaultConcessionFen = rate.defaultConcessionFen + addonBonusFen;
    const noteParts: string[] = [];
    if (rate.note) noteParts.push(rate.note);
    if (addonBonusFen > 0 && paidOrder?.addon_ids?.length) {
      noteParts.push(`含增值包分成 +¥${(addonBonusFen / 100).toFixed(2)} (${paidOrder.addon_ids.join(',')})`);
    }

    const record: ConcessionLedgerRecord = {
      id: existing?.id || `cns_${crypto.randomUUID()}`,
      teacher_id: teacherId,
      registration_id: registrationId,
      payment_order_id: paidOrder?.id || `pay_auto_${registrationId}`,
      subject_id: reg.subject_id,
      level: rate.level,
      exam_fee_fen: paidOrder?.amount_fen ?? rate.feeFen,
      default_amount_fen: totalDefaultConcessionFen,
      adjusted_amount_fen: totalDefaultConcessionFen,
      rate_source: rate.source,
      adjustment_note: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
      status: 'accrued',
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.concessionLedger.set(record.id, record);
    return record;
  }

  private voidConcessionIfUnlocked(registrationId: string): void {
    const existing = Array.from(this.concessionLedger.values()).find(
      c => c.registration_id === registrationId,
    );
    if (existing && (existing.status === 'accrued' || existing.status === 'confirmed')) {
      existing.status = 'voided';
      existing.updated_at = new Date().toISOString();
    }
  }

  /**
   * Admin confirms (and optionally adjusts on the fly) an accrued teacher concession.
   */
  confirmAndAdjustConcession(input: {
    ledger_id: string;
    adjusted_amount_fen?: number;
    adjustment_note?: string;
    confirmed_by?: string;
  }): ConcessionLedgerRecord {
    const item = this.concessionLedger.get(input.ledger_id);
    if (!item) {
      throw new Error(`Concession ledger item "${input.ledger_id}" not found`);
    }
    if (item.status === 'withdrawing' || item.status === 'paid_out') {
      throw new Error(`Cannot adjust concession "${input.ledger_id}" in status "${item.status}"`);
    }
    const now = new Date().toISOString();
    if (input.adjusted_amount_fen !== undefined) {
      if (input.adjusted_amount_fen < 0) {
        throw new Error('adjusted_amount_fen must be >= 0');
      }
      item.adjusted_amount_fen = Math.round(input.adjusted_amount_fen);
    }
    if (input.adjustment_note !== undefined) {
      item.adjustment_note = input.adjustment_note;
    }
    item.status = 'confirmed';
    item.confirmed_by = input.confirmed_by || 'admin';
    item.confirmed_at = now;
    item.updated_at = now;
    return item;
  }

  /**
   * Teacher requests withdrawal of all currently `confirmed` concessions.
   */
  requestTeacherWithdrawal(input: {
    teacher_id: string;
    teacher_note?: string;
    payout_channel?: 'wechat_transfer' | 'bank_transfer';
  }): { withdrawal: TeacherWithdrawalRecord; items: ConcessionLedgerRecord[] } {
    const eligible = Array.from(this.concessionLedger.values()).filter(
      c => c.teacher_id === input.teacher_id && c.status === 'confirmed' && c.adjusted_amount_fen > 0,
    );
    if (eligible.length === 0) {
      throw new Error(`No confirmed withdrawable concessions available for teacher "${input.teacher_id}"`);
    }
    const now = new Date().toISOString();
    const totalFen = eligible.reduce((sum, item) => sum + item.adjusted_amount_fen, 0);
    const withdrawal: TeacherWithdrawalRecord = {
      id: `wd_${crypto.randomUUID()}`,
      teacher_id: input.teacher_id,
      total_amount_fen: totalFen,
      item_count: eligible.length,
      status: 'requested',
      teacher_note: input.teacher_note,
      payout_channel: input.payout_channel || 'wechat_transfer',
      requested_at: now,
    };
    this.teacherWithdrawals.set(withdrawal.id, withdrawal);

    for (const item of eligible) {
      item.status = 'withdrawing';
      item.withdrawal_id = withdrawal.id;
      item.updated_at = now;
    }

    return { withdrawal, items: eligible };
  }

  /**
   * Admin approves and marks a teacher withdrawal request as paid out.
   */
  payoutTeacherWithdrawal(input: {
    withdrawal_id: string;
    admin_note?: string;
    payout_ref?: string;
  }): TeacherWithdrawalRecord {
    const wd = this.teacherWithdrawals.get(input.withdrawal_id);
    if (!wd) {
      throw new Error(`Withdrawal "${input.withdrawal_id}" not found`);
    }
    if (wd.status !== 'requested') {
      throw new Error(`Withdrawal "${input.withdrawal_id}" is already in status "${wd.status}"`);
    }
    const now = new Date().toISOString();
    wd.status = 'approved_paid';
    wd.admin_note = input.admin_note;
    wd.payout_ref = input.payout_ref || `wx_transfer_${crypto.randomUUID().slice(0, 10)}`;
    wd.paid_at = now;

    for (const item of this.concessionLedger.values()) {
      if (item.withdrawal_id === wd.id) {
        item.status = 'paid_out';
        item.updated_at = now;
      }
    }
    return wd;
  }

  getTeacherConcessionWallet(teacherId = 'tch_default'): {
    summary: TeacherWalletSummary;
    ledger: ConcessionLedgerRecord[];
    withdrawals: TeacherWithdrawalRecord[];
  } {
    const allLedger = Array.from(this.concessionLedger.values()).filter(
      c => c.teacher_id === teacherId,
    );
    const withdrawals = Array.from(this.teacherWithdrawals.values()).filter(
      w => w.teacher_id === teacherId,
    );
    return {
      summary: summarizeTeacherWallet(teacherId, allLedger),
      ledger: allLedger,
      withdrawals,
    };
  }

  createArchive(input: {
    learner_id: string;
    cycle_id?: string | null;
    subject_id: string;
    level: number;
    result?: string;
    certificate_no?: string;
  }): StoredArchive {
    const now = new Date().toISOString();
    const id = `arc_${crypto.randomUUID()}`;
    const record: StoredArchive = {
      id,
      learner_id: input.learner_id,
      cycle_id: input.cycle_id ?? null,
      subject_id: input.subject_id,
      level: input.level,
      result: input.result ?? '通过',
      certificate_no: input.certificate_no ?? '',
      created_at: now,
    };
    this.archives.set(id, record);
    return record;
  }

  listArchives(): StoredArchive[] {
    return Array.from(this.archives.values());
  }

  createExportBatch(input: {
    cycle_id: string;
    institution_id?: string | null;
    batch_type?: 'institution' | 'super';
    registration_ids: string[];
  }): StoredExportBatch {
    const now = new Date().toISOString();
    const jobId = `exp_job_${crypto.randomUUID()}`;
    const previewRows: Array<Record<string, string>> = [];
    const photoPaths: string[] = [];
    const snapshots: RegistrationSnapshot[] = [];

    for (const regId of input.registration_ids) {
      const reg = this.registrations.get(regId);
      if (reg?.snapshot_json) {
        snapshots.push(reg.snapshot_json);
        previewRows.push(mapSnapshotToExportRow(reg.snapshot_json));
        photoPaths.push(formatPortraitPhotoZipPath(reg.snapshot_json));
      }
    }

    const batch: StoredExportBatch = {
      job_id: jobId,
      cycle_id: input.cycle_id,
      institution_id: input.institution_id ?? null,
      batch_type: input.batch_type ?? 'super',
      registration_ids: input.registration_ids,
      item_count: input.registration_ids.length,
      status: 'queued',
      preview_rows: previewRows,
      photo_paths: photoPaths,
      snapshots,
      queued_at: now,
    };
    this.exportBatches.set(jobId, batch);
    return batch;
  }

  getExportBatch(jobId: string): StoredExportBatch | undefined {
    return this.exportBatches.get(jobId);
  }
}

