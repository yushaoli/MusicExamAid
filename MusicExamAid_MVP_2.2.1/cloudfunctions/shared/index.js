/**
 * Shared utilities for cloud functions
 */
const cloud = require('wx-server-sdk');

// ============ Response Helpers ============
const success = (data) => ({ success: true, data });
const fail = (error, code = 'ERROR') => ({ success: false, error, code });

// ============ RBAC Helpers ============

/**
 * Get auth context from cloud
 */
const getAuthContext = async (db) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) throw new Error('UNAUTHORIZED');

  // Get household
  const householdRes = await db.collection('households').where({ openid }).get();
  const household = householdRes.data[0] || null;

  // Get teacher profiles via teacher_accounts
  const accountRes = await db.collection('teacher_accounts').where({ openid }).get();
  const teacherAccount = accountRes.data[0] || null;

  let teacherProfiles = [];
  if (teacherAccount) {
    const profilesRes = await db.collection('teacher_profiles')
      .where({ teacher_account_id: teacherAccount._id })
      .get();
    teacherProfiles = profilesRes.data;
  }

  const roles = teacherProfiles.map(p => p.role);
  return {
    openid,
    household_id: household?._id || null,
    household,
    teacherAccount,
    teacherProfiles,
    isTeacher: roles.includes('Teacher') || roles.includes('Admin') || roles.includes('Super'),
    isAdmin: roles.includes('Admin') || roles.includes('Super'),
    isSuper: roles.includes('Super'),
    classIds: teacherProfiles.map(p => p.class_id),
  };
};

/**
 * Require parent access - must have household
 */
const requireParent = (ctx) => {
  if (!ctx.household_id) throw new Error('NO_HOUSEHOLD');
  return ctx;
};

/**
 * Require teacher role
 */
const requireTeacher = (ctx) => {
  if (!ctx.isTeacher) throw new Error('FORBIDDEN_NOT_TEACHER');
  return ctx;
};

/**
 * Require admin role
 */
const requireAdmin = (ctx) => {
  if (!ctx.isAdmin) throw new Error('FORBIDDEN_NOT_ADMIN');
  return ctx;
};

/**
 * Require super role
 */
const requireSuper = (ctx) => {
  if (!ctx.isSuper) throw new Error('FORBIDDEN_NOT_SUPER');
  return ctx;
};

/**
 * Check if teacher has access to class
 */
const requireClassAccess = (ctx, classId) => {
  if (!ctx.classIds.includes(classId)) throw new Error('FORBIDDEN_CLASS_ACCESS');
  return ctx;
};

// ============ Encryption Helpers ============
const crypto = require('crypto');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-key-for-dev-only!';

const encrypt = (text) => {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const decrypt = (encrypted) => {
  if (!encrypted) return '';
  const [ivHex, encryptedText] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const getLast4 = (idNumber) => {
  if (!idNumber || idNumber.length < 4) return '';
  return idNumber.slice(-4);
};

// ============ Audit Log ============
const writeAuditLog = async (db, { entity_type, entity_id, actor_openid, actor_role, action, diff_json }) => {
  await db.collection('audit_logs').add({
    data: {
      entity_type,
      entity_id,
      actor_openid,
      actor_role,
      action,
      diff_json: diff_json || {},
      created_at: db.serverDate(),
    }
  });
};

// ============ Snapshot Builder ============
const buildSnapshot = async (db, registration, learner, institution, teacherProfile) => {
  return {
    // Institution
    legacy_org_id: institution?.legacy_org_id || '',
    // Learner info
    name_cn: learner.name_cn,
    name_en_optional: learner.name_en_optional || '',
    gender: learner.gender,
    nationality: learner.nationality || '中国',
    ethnicity_optional: learner.ethnicity_optional || '',
    id_type: learner.id_type,
    id_number_plaintext: decrypt(learner.id_number_encrypted), // Decrypted for export
    guardian_phone: learner.guardian_phone,
    dob: learner.dob,
    mailing_address_optional: learner.mailing_address_optional || '',
    recipient_name_optional: learner.recipient_name_optional || '',
    recipient_phone_optional: learner.recipient_phone_optional || '',
    // Registration info
    instrument: registration.subject_id, // Will be resolved to name
    level: registration.level,
    repertoire: registration.repertoire || [],
    exam_mode: registration.exam_mode,
    exam_site_id_optional: registration.exam_site_id_optional || '',
    application_status: registration.application_status || '审核通过',
    cycle_id: registration.cycle_id,
    // Teacher info
    teacher_name_optional: teacherProfile?.teacher_name || '',
    teacher_phone_optional: teacherProfile?.teacher_phone_optional || '',
  };
};

// ============ Missing Flags Computation ============
const computeMissingFlags = (snapshot, hasPortraitPhoto) => {
  const flags = [];
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
};

module.exports = {
  success,
  fail,
  getAuthContext,
  requireParent,
  requireTeacher,
  requireAdmin,
  requireSuper,
  requireClassAccess,
  encrypt,
  decrypt,
  getLast4,
  writeAuditLog,
  buildSnapshot,
  computeMissingFlags,
};

