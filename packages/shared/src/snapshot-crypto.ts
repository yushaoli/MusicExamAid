/**
 * Learner ID encryption, registration snapshot builder, missing-flags checker,
 * and Template v2.1 strict header export mapper.
 */

import * as crypto from 'crypto';

const DEFAULT_DEV_KEY = 'default-32-char-key-for-dev-only!';

function normalizeKey(key?: string): Buffer {
  const raw = (key || process.env.ENCRYPTION_KEY || DEFAULT_DEV_KEY).padEnd(32, '0').slice(0, 32);
  return Buffer.from(raw, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. AES-256-CBC ID Encryption & Masking
// ---------------------------------------------------------------------------

export function encryptIdNumber(plaintext: string, key?: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', normalizeKey(key), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptIdNumber(encrypted: string, key?: string): string {
  if (!encrypted) return '';
  const parts = encrypted.split(':');
  if (parts.length !== 2) {
    throw new Error('Malformed encrypted ID payload');
  }
  const [ivHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', normalizeKey(key), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function getIdLast4(idNumber: string): string {
  if (!idNumber || idNumber.length < 4) return '';
  return idNumber.slice(-4);
}

// ---------------------------------------------------------------------------
// 2. Registration Snapshot Builder & Missing Flags
// ---------------------------------------------------------------------------

export interface SnapshotLearnerInput {
  name_cn: string;
  name_en_optional?: string;
  gender: '男' | '女';
  nationality?: string;
  ethnicity_optional?: string;
  id_type: string;
  id_number_encrypted: string;
  guardian_phone: string;
  dob: string;
  mailing_address_optional?: string;
  recipient_name_optional?: string;
  recipient_phone_optional?: string;
}

export interface SnapshotRegistrationInput {
  subject_id: string;
  level: number | string;
  repertoire?: string[];
  exam_mode: '现场' | '视频' | '音基';
  exam_site_id_optional?: string;
  application_status?: '未申请' | '审核中' | '审核通过';
  cycle_id: string;
}

export interface SnapshotInstitutionInput {
  legacy_org_id?: string;
}

export interface SnapshotTeacherInput {
  teacher_name?: string;
  teacher_phone?: string;
}

export interface RegistrationSnapshot {
  legacy_org_id: string;
  name_cn: string;
  name_en_optional: string;
  gender: '男' | '女';
  nationality: string;
  ethnicity_optional: string;
  id_type: string;
  id_number_plaintext: string;
  guardian_phone: string;
  dob: string;
  mailing_address_optional: string;
  recipient_name_optional: string;
  recipient_phone_optional: string;
  instrument: string;
  level: string;
  repertoire: string[];
  exam_mode: '现场' | '视频' | '音基';
  exam_site_id_optional: string;
  application_status: '未申请' | '审核中' | '审核通过';
  cycle_id: string;
  teacher_name_optional: string;
  teacher_phone_optional: string;
}

export function buildRegistrationSnapshot(params: {
  registration: SnapshotRegistrationInput;
  learner: SnapshotLearnerInput;
  institution?: SnapshotInstitutionInput | null;
  teacherProfile?: SnapshotTeacherInput | null;
  encryptionKey?: string;
}): RegistrationSnapshot {
  const { registration, learner, institution, teacherProfile, encryptionKey } = params;
  const rep = Array.isArray(registration.repertoire) ? registration.repertoire : [];
  const paddedRepertoire = [
    rep[0] ?? '',
    rep[1] ?? '',
    rep[2] ?? '',
    rep[3] ?? '',
  ];

  return {
    legacy_org_id: institution?.legacy_org_id || '',
    name_cn: learner.name_cn,
    name_en_optional: learner.name_en_optional || '',
    gender: learner.gender,
    nationality: learner.nationality || '中国',
    ethnicity_optional: learner.ethnicity_optional || '',
    id_type: learner.id_type,
    id_number_plaintext: decryptIdNumber(learner.id_number_encrypted, encryptionKey),
    guardian_phone: learner.guardian_phone,
    dob: learner.dob,
    mailing_address_optional: learner.mailing_address_optional || '',
    recipient_name_optional: learner.recipient_name_optional || '',
    recipient_phone_optional: learner.recipient_phone_optional || '',
    instrument: registration.subject_id,
    level: String(registration.level),
    repertoire: paddedRepertoire,
    exam_mode: registration.exam_mode,
    exam_site_id_optional: registration.exam_site_id_optional || '',
    application_status: registration.application_status || '审核通过',
    cycle_id: registration.cycle_id,
    teacher_name_optional: teacherProfile?.teacher_name || '',
    teacher_phone_optional: teacherProfile?.teacher_phone || '',
  };
}

export function computeMissingFlags(
  snapshot: RegistrationSnapshot,
  hasPortraitPhoto: boolean,
): string[] {
  const flags: string[] = [];
  if (!snapshot.name_cn) flags.push('name_cn');
  if (!snapshot.gender) flags.push('gender');
  if (!snapshot.id_type) flags.push('id_type');
  if (!snapshot.id_number_plaintext) flags.push('id_number');
  if (!snapshot.guardian_phone) flags.push('guardian_phone');
  if (!snapshot.dob) flags.push('dob');
  if (!snapshot.instrument) flags.push('instrument');
  if (!snapshot.level) flags.push('level');
  if (!snapshot.exam_mode) flags.push('exam_mode');
  if (!hasPortraitPhoto) flags.push('portrait_photo');
  return flags;
}

// ---------------------------------------------------------------------------
// 3. Template v2.1 Strict Header Export Row Mapper
// ---------------------------------------------------------------------------

function normalizeDateYYYYMMDD(val: string): string {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function mapSnapshotToExportRow(
  snapshot: RegistrationSnapshot,
): Record<string, string> {
  return {
    报名机构ID: String(snapshot.legacy_org_id ?? ''),
    报名点ID: String(snapshot.exam_site_id_optional ?? ''),
    姓名: (snapshot.name_cn ?? '').trim(),
    拼音或英文: (snapshot.name_en_optional ?? '').trim(),
    性别: snapshot.gender === '男' || snapshot.gender === '女' ? snapshot.gender : '',
    国籍: (snapshot.nationality ?? '').trim() || '中国',
    民族: (snapshot.ethnicity_optional ?? '').trim(),
    证件类型: (snapshot.id_type ?? '').trim(),
    证件号码: String(snapshot.id_number_plaintext ?? ''),
    联系电话: String(snapshot.guardian_phone ?? ''),
    出生日期: normalizeDateYYYYMMDD(snapshot.dob),
    邮寄地址: (snapshot.mailing_address_optional ?? '').trim(),
    收件人: (snapshot.recipient_name_optional ?? '').trim(),
    收件电话: String(snapshot.recipient_phone_optional ?? ''),
    报考专业: (snapshot.instrument ?? '').trim(),
    报考级别: String(snapshot.level ?? ''),
    考试曲目1: (snapshot.repertoire?.[0] ?? '').trim(),
    考试曲目2: (snapshot.repertoire?.[1] ?? '').trim(),
    考试曲目3: (snapshot.repertoire?.[2] ?? '').trim(),
    考试曲目4: (snapshot.repertoire?.[3] ?? '').trim(),
    集体老师姓名: (snapshot.teacher_name_optional ?? '').trim(),
    集体老师联系电话: String(snapshot.teacher_phone_optional ?? ''),
    考试方式: ['现场', '视频', '音基'].includes(snapshot.exam_mode)
      ? snapshot.exam_mode
      : '',
    报考状态: ['未申请', '审核中', '审核通过'].includes(snapshot.application_status)
      ? snapshot.application_status
      : '审核通过',
    考期: (snapshot.cycle_id ?? '').trim(),
  };
}
