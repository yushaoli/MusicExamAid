/**
 * Learner ID encryption (AES-256-GCM with legacy CBC fallback),
 * registration snapshot builder (keeps ID encrypted at rest),
 * subject dictionary resolver, missing-flags checker,
 * and Template v2.1 strict header export mapper & CSV serializer.
 */

import * as crypto from 'crypto';

const DEFAULT_DEV_KEY = 'default-32-char-key-for-dev-only!';

function normalizeKey(key?: string): Buffer {
  const raw = (key || process.env.ENCRYPTION_KEY || DEFAULT_DEV_KEY)
    .padEnd(32, '0')
    .slice(0, 32);
  return Buffer.from(raw, 'utf8');
}

// ---------------------------------------------------------------------------
// 0. Canonical Subject Dictionary (resolves subject_id -> Chinese name)
// ---------------------------------------------------------------------------

export const SUBJECT_NAME_MAP: Readonly<Record<string, string>> = {
  piano: '钢琴',
  violin: '小提琴',
  guzheng: '古筝',
  erhu: '二胡',
  pipa: '琵琶',
  flute: '长笛',
  clarinet: '单簧管',
  saxophone: '萨克斯',
  guitar: '吉他',
  vocal: '声乐',
  music_theory: '音乐基础知识',
};

export function resolveSubjectName(subjectIdOrName: string): string {
  const trimmed = (subjectIdOrName || '').trim();
  return SUBJECT_NAME_MAP[trimmed] ?? trimmed;
}

// ---------------------------------------------------------------------------
// 1. AES-256-GCM ID Encryption (with legacy AES-256-CBC decrypt support)
// ---------------------------------------------------------------------------

/**
 * Encrypts sensitive ID numbers using authenticated AES-256-GCM (`gcm:<iv>:<tag>:<ciphertext>`).
 */
export function encryptIdNumber(plaintext: string, key?: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', normalizeKey(key), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts `gcm:<iv>:<tag>:<ct>` or legacy `<iv>:<ct>` (AES-256-CBC) payloads.
 */
export function decryptIdNumber(encrypted: string, key?: string): string {
  if (!encrypted) return '';
  const parts = encrypted.split(':');

  if (parts[0] === 'gcm' && parts.length === 4) {
    const [, ivHex, tagHex, cipherHex] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      normalizeKey(key),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  if (parts.length === 2) {
    const [ivHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      normalizeKey(key),
      iv,
    );
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error('Malformed encrypted ID payload');
}

export function getIdLast4(idNumber: string): string {
  if (!idNumber || idNumber.length < 4) return '';
  return idNumber.slice(-4);
}

// ---------------------------------------------------------------------------
// 2. Registration Snapshot Builder (Encrypted at Rest) & Missing Flags
// ---------------------------------------------------------------------------

export interface SnapshotLearnerInput {
  name_cn: string;
  name_en_optional?: string;
  gender: '男' | '女';
  nationality?: string;
  ethnicity_optional?: string;
  id_type: string;
  id_number_encrypted: string;
  id_last4?: string;
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

/**
 * Snapshot stored in `registrations.snapshot_json`.
 * Note: `id_number_encrypted` is stored encrypted at rest; plaintext is only
 * materialized in memory during export (`mapSnapshotToExportRow`).
 */
export interface RegistrationSnapshot {
  legacy_org_id: string;
  name_cn: string;
  name_en_optional: string;
  gender: '男' | '女';
  nationality: string;
  ethnicity_optional: string;
  id_type: string;
  id_number_encrypted: string;
  id_last4: string;
  guardian_phone: string;
  dob: string;
  mailing_address_optional: string;
  recipient_name_optional: string;
  recipient_phone_optional: string;
  instrument: string;
  subject_id: string;
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
  const { registration, learner, institution, teacherProfile, encryptionKey } =
    params;
  const rep = Array.isArray(registration.repertoire)
    ? registration.repertoire
    : [];
  const paddedRepertoire = [
    rep[0] ?? '',
    rep[1] ?? '',
    rep[2] ?? '',
    rep[3] ?? '',
  ];

  // Verify encrypted ID is valid and derive last4 if not provided
  const decryptedForCheck = decryptIdNumber(
    learner.id_number_encrypted,
    encryptionKey,
  );
  const idLast4 = learner.id_last4 || getIdLast4(decryptedForCheck);

  return {
    legacy_org_id: institution?.legacy_org_id || '',
    name_cn: learner.name_cn,
    name_en_optional: learner.name_en_optional || '',
    gender: learner.gender,
    nationality: learner.nationality || '中国',
    ethnicity_optional: learner.ethnicity_optional || '',
    id_type: learner.id_type,
    id_number_encrypted: learner.id_number_encrypted,
    id_last4: idLast4,
    guardian_phone: learner.guardian_phone,
    dob: learner.dob,
    mailing_address_optional: learner.mailing_address_optional || '',
    recipient_name_optional: learner.recipient_name_optional || '',
    recipient_phone_optional: learner.recipient_phone_optional || '',
    instrument: resolveSubjectName(registration.subject_id),
    subject_id: registration.subject_id,
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
  if (!snapshot.id_number_encrypted) flags.push('id_number');
  if (!snapshot.guardian_phone) flags.push('guardian_phone');
  if (!snapshot.dob) flags.push('dob');
  if (!snapshot.instrument) flags.push('instrument');
  if (!snapshot.level) flags.push('level');
  if (!snapshot.exam_mode) flags.push('exam_mode');
  if (!hasPortraitPhoto) flags.push('portrait_photo');
  return flags;
}

// ---------------------------------------------------------------------------
// 3. Template v2.1 Strict Header Export Row Mapper & CSV Serializer
// ---------------------------------------------------------------------------

export const TEMPLATE_V2_1_HEADERS = [
  '报名机构ID',
  '报名点ID',
  '姓名',
  '拼音或英文',
  '性别',
  '国籍',
  '民族',
  '证件类型',
  '证件号码',
  '联系电话',
  '出生日期',
  '邮寄地址',
  '收件人',
  '收件电话',
  '报考专业',
  '报考级别',
  '考试曲目1',
  '考试曲目2',
  '考试曲目3',
  '考试曲目4',
  '集体老师姓名',
  '集体老师联系电话',
  '考试方式',
  '报考状态',
  '考期',
] as const;

function normalizeDateYYYYMMDD(val: string): string {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Decrypts `id_number_encrypted` ONLY in memory at export time and maps the
 * snapshot into Template v2.1 column headers.
 */
export function mapSnapshotToExportRow(
  snapshot: RegistrationSnapshot,
  encryptionKey?: string,
): Record<string, string> {
  const plaintextId = decryptIdNumber(
    snapshot.id_number_encrypted,
    encryptionKey,
  );
  return {
    报名机构ID: String(snapshot.legacy_org_id ?? ''),
    报名点ID: String(snapshot.exam_site_id_optional ?? ''),
    姓名: (snapshot.name_cn ?? '').trim(),
    拼音或英文: (snapshot.name_en_optional ?? '').trim(),
    性别: snapshot.gender === '男' || snapshot.gender === '女' ? snapshot.gender : '',
    国籍: (snapshot.nationality ?? '').trim() || '中国',
    民族: (snapshot.ethnicity_optional ?? '').trim(),
    证件类型: (snapshot.id_type ?? '').trim(),
    证件号码: String(plaintextId ?? ''),
    联系电话: String(snapshot.guardian_phone ?? ''),
    出生日期: normalizeDateYYYYMMDD(snapshot.dob),
    邮寄地址: (snapshot.mailing_address_optional ?? '').trim(),
    收件人: (snapshot.recipient_name_optional ?? '').trim(),
    收件电话: String(snapshot.recipient_phone_optional ?? ''),
    报考专业: resolveSubjectName(snapshot.instrument || snapshot.subject_id),
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

const TEXT_FORCE_HEADERS = new Set([
  '报名机构ID',
  '报名点ID',
  '证件号码',
  '联系电话',
  '收件电话',
  '集体老师联系电话',
  '出生日期',
]);

/**
 * Serializes Template v2.1 export rows into an Excel-compatible UTF-8 BOM CSV
 * where ID numbers, phone numbers, and dates are guarded against scientific notation.
 */
export function serializeExportRowsToCsv(
  rows: ReadonlyArray<Record<string, string>>,
): string {
  const escapeCsvCell = (header: string, rawVal: string): string => {
    const val = rawVal ?? '';
    if (TEXT_FORCE_HEADERS.has(header) && val !== '') {
      // Tab prefix inside quotes forces Excel to treat numeric strings as text
      return `"\t${val.replace(/"/g, '""')}"`;
    }
    return `"${val.replace(/"/g, '""')}"`;
  };

  const headerLine = TEMPLATE_V2_1_HEADERS.map(h => `"${h}"`).join(',');
  const dataLines = rows.map(row =>
    TEMPLATE_V2_1_HEADERS.map(h => escapeCsvCell(h, row[h] ?? '')).join(','),
  );

  return '\uFEFF' + [headerLine, ...dataLines].join('\r\n') + '\r\n';
}
