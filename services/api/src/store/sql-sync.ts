import crypto from "node:crypto";
import { getPool } from "./postgres.js";
import type {
  StoredLearner,
  StoredRegistration,
  StoredArchive,
  StoredExportBatch,
} from "./repository.js";

function toDeterministicUuid(rawId: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(rawId)) return rawId.toLowerCase();
  const hash = crypto.createHash("sha256").update(rawId).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),
    "a" + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

const DEFAULT_PARENT_OPENID = "mp_default_parent_openid";
const DEFAULT_INSTITUTION_NAME = "星光艺术培训中心 (XGAR Default)";

export async function ensureDefaultParentAndInstitution(
  connectionString?: string
): Promise<{ parentUserUuid: string; institutionUuid: string }> {
  const pool = getPool(connectionString);
  const userRes = await pool.query<{ id: string }>(
    `INSERT INTO users (openid, role)
     VALUES ($1, 'parent')
     ON CONFLICT (openid) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [DEFAULT_PARENT_OPENID]
  );
  const parentUserUuid = userRes.rows[0]!.id;

  const instUuid = toDeterministicUuid("inst-xgar-default");
  await pool.query(
    `INSERT INTO institutions (id, name, legacy_org_id)
     VALUES ($1, $2, 'inst-xgar-default')
     ON CONFLICT (id) DO NOTHING`,
    [instUuid, DEFAULT_INSTITUTION_NAME]
  );

  return { parentUserUuid, institutionUuid: instUuid };
}

export async function persistLearnerToPostgres(
  learner: StoredLearner,
  connectionString?: string
): Promise<{ learnerUuid: string }> {
  const pool = getPool(connectionString);
  const { parentUserUuid } = await ensureDefaultParentAndInstitution(connectionString);
  const learnerUuid = toDeterministicUuid(learner.id);

  await pool.query(
    `INSERT INTO learners (
       id, parent_user_id, name_cn, name_en_optional, gender, dob,
       nationality, ethnicity_optional, id_type, id_number_encrypted,
       id_last4, guardian_phone, mailing_address_optional,
       recipient_name_optional, recipient_phone_optional
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       name_cn = EXCLUDED.name_cn,
       guardian_phone = EXCLUDED.guardian_phone,
       updated_at = NOW()`,
    [
      learnerUuid,
      parentUserUuid,
      learner.name_cn,
      learner.name_en_optional,
      learner.gender,
      learner.dob,
      learner.nationality,
      learner.ethnicity_optional,
      learner.id_type,
      learner.id_number_encrypted,
      learner.id_last4,
      learner.guardian_phone,
      learner.mailing_address_optional,
      learner.recipient_name_optional,
      learner.recipient_phone_optional,
    ]
  );

  return { learnerUuid };
}

export async function persistAttachmentToPostgres(
  input: {
    ownerType: "learner" | "registration" | "exam_record";
    ownerId: string;
    fileType: string;
    s3Key: string;
    contentType?: string;
    sizeBytes: number;
  },
  connectionString?: string
): Promise<{ attachmentUuid: string }> {
  const pool = getPool(connectionString);
  const ownerUuid = toDeterministicUuid(input.ownerId);
  const attachmentUuid = toDeterministicUuid(
    `${input.ownerType}:${input.ownerId}:${input.fileType}`
  );

  await pool.query(
    `INSERT INTO attachments (id, owner_type, owner_id, file_type, s3_key, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       s3_key = EXCLUDED.s3_key,
       size_bytes = EXCLUDED.size_bytes`,
    [
      attachmentUuid,
      input.ownerType,
      ownerUuid,
      input.fileType,
      input.s3Key,
      input.contentType ?? "image/jpeg",
      input.sizeBytes,
    ]
  );

  return { attachmentUuid };
}

export async function persistRegistrationToPostgres(
  reg: StoredRegistration,
  connectionString?: string
): Promise<{ registrationUuid: string }> {
  const pool = getPool(connectionString);
  const { institutionUuid } = await ensureDefaultParentAndInstitution(connectionString);
  const regUuid = toDeterministicUuid(reg.id);
  const learnerUuid = toDeterministicUuid(reg.learner_id);
  const instUuid = reg.institution_id
    ? toDeterministicUuid(reg.institution_id)
    : institutionUuid;

  if (reg.institution_id) {
    await pool.query(
      `INSERT INTO institutions (id, name, legacy_org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [instUuid, `Institution ${reg.institution_id}`, reg.institution_id]
    );
  }

  await pool.query(
    `INSERT INTO dict_cycles (cycle_id, display_name)
     VALUES ($1, $1)
     ON CONFLICT (cycle_id) DO NOTHING`,
    [reg.cycle_id]
  );

  await pool.query(
    `INSERT INTO dict_subjects (subject_id, subject_name)
     VALUES ($1, $1)
     ON CONFLICT (subject_id) DO NOTHING`,
    [reg.subject_id]
  );

  await pool.query(
    `INSERT INTO registrations (
       id, learner_id, institution_id, cycle_id, subject_id, level,
       exam_mode, exam_site_id_optional, repertoire, status, teacher_notes,
       snapshot_json, missing_flags, locked_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb,$14)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       teacher_notes = EXCLUDED.teacher_notes,
       snapshot_json = EXCLUDED.snapshot_json,
       missing_flags = EXCLUDED.missing_flags,
       locked_at = EXCLUDED.locked_at,
       updated_at = NOW()`,
    [
      regUuid,
      learnerUuid,
      instUuid,
      reg.cycle_id,
      reg.subject_id,
      reg.level,
      reg.exam_mode,
      reg.exam_site_id_optional,
      JSON.stringify(reg.repertoire),
      reg.status,
      reg.teacher_notes,
      reg.snapshot_json ? JSON.stringify(reg.snapshot_json) : null,
      JSON.stringify(reg.missing_flags),
      reg.locked_at,
    ]
  );

  return { registrationUuid: regUuid };
}

export async function persistArchiveToPostgres(
  archive: StoredArchive,
  connectionString?: string
): Promise<{ archiveUuid: string }> {
  const pool = getPool(connectionString);
  const archiveUuid = toDeterministicUuid(archive.id);
  const learnerUuid = toDeterministicUuid(archive.learner_id);

  if (archive.cycle_id) {
    await pool.query(
      `INSERT INTO dict_cycles (cycle_id, display_name)
       VALUES ($1, $1)
       ON CONFLICT (cycle_id) DO NOTHING`,
      [archive.cycle_id]
    );
  }
  await pool.query(
    `INSERT INTO dict_subjects (subject_id, subject_name)
     VALUES ($1, $1)
     ON CONFLICT (subject_id) DO NOTHING`,
    [archive.subject_id]
  );

  await pool.query(
    `INSERT INTO exam_records (id, learner_id, cycle_id, subject_id, level, result, certificate_no)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       result = EXCLUDED.result,
       certificate_no = EXCLUDED.certificate_no`,
    [
      archiveUuid,
      learnerUuid,
      archive.cycle_id,
      archive.subject_id,
      archive.level,
      archive.result,
      archive.certificate_no,
    ]
  );

  return { archiveUuid };
}

export async function persistExportBatchToPostgres(
  batch: StoredExportBatch,
  s3ExportKey?: string,
  connectionString?: string
): Promise<{ exportUuid: string }> {
  const pool = getPool(connectionString);
  const exportUuid = toDeterministicUuid(batch.job_id);
  const instUuid = batch.institution_id
    ? toDeterministicUuid(batch.institution_id)
    : null;

  await pool.query(
    `INSERT INTO dict_cycles (cycle_id, display_name)
     VALUES ($1, $1)
     ON CONFLICT (cycle_id) DO NOTHING`,
    [batch.cycle_id]
  );

  await pool.query(
    `INSERT INTO export_batches (
       id, cycle_id, institution_id, batch_type, status, registration_ids, s3_export_key, exported_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       s3_export_key = COALESCE(EXCLUDED.s3_export_key, export_batches.s3_export_key),
       exported_at = COALESCE(EXCLUDED.exported_at, export_batches.exported_at),
       updated_at = NOW()`,
    [
      exportUuid,
      batch.cycle_id,
      instUuid,
      batch.batch_type,
      batch.status,
      JSON.stringify(batch.registration_ids),
      s3ExportKey ?? null,
      batch.status === "exported" ? new Date().toISOString() : null,
    ]
  );

  return { exportUuid };
}
