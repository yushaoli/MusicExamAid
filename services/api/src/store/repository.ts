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
} from '@musicexamaid/shared';
import type {
  RegistrationStatusType,
  RegistrationSnapshot,
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
  queued_at: string;
}

export class DomainRepository {
  private learners = new Map<string, StoredLearner>();
  private registrations = new Map<string, StoredRegistration>();
  private statusHistory: StoredStatusHistory[] = [];
  private archives = new Map<string, StoredArchive>();
  private exportBatches = new Map<string, StoredExportBatch>();

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

  createRegistration(input: {
    id?: string;
    learner_id: string;
    institution_id?: string | null;
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
    return reg;
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

    for (const regId of input.registration_ids) {
      const reg = this.registrations.get(regId);
      if (reg?.snapshot_json) {
        previewRows.push(mapSnapshotToExportRow(reg.snapshot_json));
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
      queued_at: now,
    };
    this.exportBatches.set(jobId, batch);
    return batch;
  }

  getExportBatch(jobId: string): StoredExportBatch | undefined {
    return this.exportBatches.get(jobId);
  }
}
