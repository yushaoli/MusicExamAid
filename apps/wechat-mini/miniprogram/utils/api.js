/**
 * MusicExamAid Mini Program API wrapper (100% Mainland China PIPL-Compliant Transport).
 *
 * Transport modes (zero personal data ever leaves Mainland China):
 * 1. Direct HTTPS RPC to `https://mea.xgar.com.cn/rpc/:action` on `ubtxiaomi` (`100.64.0.4`, Shanghai)
 * 2. Automatic fallback to Tencent Cloud Mainland (`wx.cloud.callFunction`) when a parent is on
 *    external cellular network without Tailnet/LAN access, which `ubtxiaomi` drains into local
 *    PostgreSQL (`:55432`) and MinIO (`:9010`).
 */

const DEFAULT_API_BASE_URL = 'https://mea.xgar.com.cn';

const getApiBaseUrl = () => {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const override = wx.getStorageSync('MEA_API_BASE_URL');
      if (override) return String(override).replace(/\/+$/, '');
    }
  } catch (_e) {
    // ignore storage read errors
  }
  return DEFAULT_API_BASE_URL;
};

const callWxCloudMainland = (name, data = {}) =>
  new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
      reject(new Error(`RPC ${name}: wx.cloud unavailable and direct Mainland endpoint unreachable`));
      return;
    }
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        if (res.result && res.result.success) {
          resolve(res.result.data);
        } else {
          reject(new Error(res.result?.error || 'Cloud function error'));
        }
      },
      fail: (err) => reject(err),
    });
  });

const getParentSessionHeader = () => {
  try {
    const token = wx.getStorageSync('MEA_PARENT_SESSION');
    return token ? {'X-Mea-Parent-Session': token} : {};
  } catch (_e) {
    return {};
  }
};

const callParentApi = (path, method = 'GET', data) => new Promise((resolve, reject) => {
  wx.request({
    url: `${getApiBaseUrl()}${path}`,
    method,
    data,
    header: {
      'Content-Type': 'application/json',
      ...getParentSessionHeader(),
    },
    success: (res) => {
      const body = res.data || {};
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(body);
      } else {
        reject(new Error(body.error || body.message || `HTTP ${res.statusCode}`));
      }
    },
    fail: (err) => reject(new Error(err?.errMsg || 'Network request failed')),
  });
});

const callCloud = (name, data = {}) => {
  const url = `${getApiBaseUrl()}/rpc/${encodeURIComponent(name)}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data,
      header: {
        'Content-Type': 'application/json',
        ...getParentSessionHeader(),
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success) {
          resolve(body.data);
        } else {
          const err = new Error(body.error || `HTTP ${res.statusCode}`);
          console.error(`RPC ${name} failed:`, err);
          reject(err);
        }
      },
      fail: (err) => {
        if (typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction) {
          callWxCloudMainland(name, data).then(resolve).catch(reject);
          return;
        }
        console.error(`RPC ${name} network error:`, err);
        reject(new Error(err?.errMsg || 'Network request failed'));
      },
    });
  });
};

// ============ Auth ============
export const authLogin = (code) => callParentApi('/parent/auth', 'POST', { code });
export const parentSession = () => callParentApi('/parent/session');

// ============ Parent: Learner ============
const withLegacyLearnerId = (learner) => ({ _id: learner.id, ...learner });
const withLegacyRegistrationFields = (registration) => ({
  _id: registration.id,
  ...registration,
  workflow_status: registration.status,
});

export const learnerList = () => callParentApi('/parent/learners')
  .then((body) => body.items.map(withLegacyLearnerId));
export const learnerGet = (learner_id) =>
  callParentApi(`/parent/learners/${encodeURIComponent(learner_id)}`).then(withLegacyLearnerId);
export const learnerUpsert = (data) => callCloud('learnerUpsert', data);

// ============ Parent: Enrollment ============
export const enrollmentCreateOrUpdate = (data) => callCloud('enrollmentCreateOrUpdate', data);
export const institutionList = () => callCloud('institutionList');

// ============ Parent: Registration ============
export const registrationCreate = (data) => callParentApi('/parent/registrations', 'POST', data)
  .then(withLegacyRegistrationFields);
export const registrationUpdate = (data) => callCloud('registrationUpdate', data);
export const registrationSubmit = (reg_id) =>
  callParentApi(`/parent/registrations/${encodeURIComponent(reg_id)}/submit`, 'POST', {})
    .then(withLegacyRegistrationFields);
export const registrationList = (filters = {}) => callParentApi('/parent/registrations')
  .then((body) => body.items.map(withLegacyRegistrationFields));
export const registrationGet = async (reg_id) => {
  const registration = await callParentApi(`/parent/registrations/${encodeURIComponent(reg_id)}`);
  const learner = await learnerGet(registration.learner_id);
  return {...withLegacyRegistrationFields(registration), learner};
};

// ============ Attachments ============
export const attachmentCommit = (data) => callCloud('attachmentCommit', data);

// ============ Teacher ============
export const teacherRosterList = (filters) => callCloud('teacherRosterList', filters);
export const teacherRegistrationGetDetail = (reg_id) => callCloud('teacherRegistrationGetDetail', { reg_id });
export const teacherRequestChanges = (reg_id, teacher_notes) => callCloud('teacherRequestChanges', { reg_id, teacher_notes });
export const teacherConfirm = (reg_id) => callCloud('teacherConfirm', { reg_id });
export const teacherLock = (reg_id) => callCloud('teacherLock', { reg_id });
export const teacherUnlock = (reg_id, reason) => callCloud('teacherUnlock', { reg_id, reason });
export const teacherSubmitToInstitution = (reg_id) => callCloud('teacherSubmitToInstitution', { reg_id });

// ============ Institution Admin ============
export const instBatchCreate = (data) => callCloud('instBatchCreate', data);
export const instBatchList = (filters) => callCloud('instBatchList', filters);
export const instBatchGet = (batch_id) => callCloud('instBatchGet', { batch_id });
export const instBatchAddItems = (batch_id, reg_ids) => callCloud('instBatchAddItems', { batch_id, reg_ids });
export const instBatchRemoveItems = (batch_id, item_ids) => callCloud('instBatchRemoveItems', { batch_id, item_ids });
export const instBatchPreflight = (batch_id) => callCloud('instBatchPreflight', { batch_id });
export const instBatchSubmitToSuper = (batch_id) => callCloud('instBatchSubmitToSuper', { batch_id });

// ============ Super ============
export const superIncomingInstBatchesList = (filters) => callCloud('superIncomingInstBatchesList', filters);
export const superBatchCreate = (data) => callCloud('superBatchCreate', data);
export const superBatchGet = (batch_id) => callCloud('superBatchGet', { batch_id });
export const superBatchIngestInstitutionBatches = (super_batch_id, inst_batch_ids) =>
  callCloud('superBatchIngestInstitutionBatches', { super_batch_id, inst_batch_ids });
export const superBatchDedupRun = (super_batch_id) => callCloud('superBatchDedupRun', { super_batch_id });
export const superBatchResolveConflict = (item_id, action) => callCloud('superBatchResolveConflict', { item_id, action });
export const superBatchPreflight = (super_batch_id) => callCloud('superBatchPreflight', { super_batch_id });
export const superBatchExportOnce = (super_batch_id) => callCloud('superBatchExportOnce', { super_batch_id });

// ============ Dictionaries ============
export const getDictSubjects = () => callCloud('getDictSubjects');
export const getDictCycles = () => callCloud('getDictCycles');

// ============ WeChat Pay & Teacher Accumulated Concessions (Per-Teacher × Per-Grade) ============
export const teacherRateCardsGet = (teacher_id = 'tch_default') =>
  callCloud('teacherRateCardsGet', { teacher_id });
export const adminUpsertTeacherRateCard = (teacher_id, level, exam_fee_fen, concession_fen, note = '') =>
  callCloud('adminUpsertTeacherRateCard', { teacher_id, level, exam_fee_fen, concession_fen, note });
export const paymentCheckout = (reg_id, teacher_id) =>
  callCloud('paymentCheckout', { reg_id, teacher_id });
export const teacherConcessionWallet = (teacher_id = 'tch_default') =>
  callCloud('teacherConcessionWallet', { teacher_id });
export const adminConfirmConcession = (ledger_id, adjusted_amount_fen, adjustment_note) =>
  callCloud('adminConfirmConcession', { ledger_id, adjusted_amount_fen, adjustment_note });
export const teacherRequestWithdrawal = (teacher_id = 'tch_default', teacher_note = '') =>
  callCloud('teacherRequestWithdrawal', { teacher_id, teacher_note });
export const adminPayoutWithdrawal = (withdrawal_id, admin_note = '', payout_ref = '') =>
  callCloud('adminPayoutWithdrawal', { withdrawal_id, admin_note, payout_ref });

export default {
  authLogin, parentSession,
  learnerList, learnerGet, learnerUpsert,
  enrollmentCreateOrUpdate, institutionList,
  registrationCreate, registrationUpdate, registrationSubmit, registrationList, registrationGet,
  attachmentCommit,
  teacherRosterList, teacherRegistrationGetDetail, teacherRequestChanges, teacherConfirm, teacherLock, teacherUnlock, teacherSubmitToInstitution,
  instBatchCreate, instBatchList, instBatchGet, instBatchAddItems, instBatchRemoveItems, instBatchPreflight, instBatchSubmitToSuper,
  superIncomingInstBatchesList, superBatchCreate, superBatchGet, superBatchIngestInstitutionBatches, superBatchDedupRun, superBatchResolveConflict, superBatchPreflight, superBatchExportOnce,
  getDictSubjects, getDictCycles,
  teacherRateCardsGet, adminUpsertTeacherRateCard, paymentCheckout, teacherConcessionWallet, adminConfirmConcession, teacherRequestWithdrawal, adminPayoutWithdrawal,
};


