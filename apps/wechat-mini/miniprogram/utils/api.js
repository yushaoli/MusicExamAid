/**
 * MusicExamAid Mini Program API wrapper (Zero-Rewrite Cutover to mea.xgar.com.cn).
 *
 * Replaces `wx.cloud.callFunction` with HTTPS `wx.request` calls to
 * `POST https://mea.xgar.com.cn/rpc/:action` while keeping all 29 exported
 * function signatures identical for existing Mini Program pages.
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

const callCloud = (name, data = {}) => {
  const url = `${getApiBaseUrl()}/rpc/${encodeURIComponent(name)}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'POST',
      data,
      header: {
        'Content-Type': 'application/json',
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
        console.error(`RPC ${name} network error:`, err);
        reject(new Error(err?.errMsg || 'Network request failed'));
      },
    });
  });
};

// ============ Auth ============
export const authLogin = () => callCloud('authLogin');

// ============ Parent: Learner ============
export const learnerList = () => callCloud('learnerList');
export const learnerGet = (learner_id) => callCloud('learnerGet', { learner_id });
export const learnerUpsert = (data) => callCloud('learnerUpsert', data);

// ============ Parent: Enrollment ============
export const enrollmentCreateOrUpdate = (data) => callCloud('enrollmentCreateOrUpdate', data);
export const institutionList = () => callCloud('institutionList');

// ============ Parent: Registration ============
export const registrationCreate = (data) => callCloud('registrationCreate', data);
export const registrationUpdate = (data) => callCloud('registrationUpdate', data);
export const registrationSubmit = (reg_id) => callCloud('registrationSubmit', { reg_id });
export const registrationList = (filters = {}) => callCloud('registrationList', filters);
export const registrationGet = (reg_id) => callCloud('registrationGet', { reg_id });

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

export default {
  authLogin,
  learnerList, learnerGet, learnerUpsert,
  enrollmentCreateOrUpdate, institutionList,
  registrationCreate, registrationUpdate, registrationSubmit, registrationList, registrationGet,
  attachmentCommit,
  teacherRosterList, teacherRegistrationGetDetail, teacherRequestChanges, teacherConfirm, teacherLock, teacherUnlock, teacherSubmitToInstitution,
  instBatchCreate, instBatchList, instBatchGet, instBatchAddItems, instBatchRemoveItems, instBatchPreflight, instBatchSubmitToSuper,
  superIncomingInstBatchesList, superBatchCreate, superBatchGet, superBatchIngestInstitutionBatches, superBatchDedupRun, superBatchResolveConflict, superBatchPreflight, superBatchExportOnce,
  getDictSubjects, getDictCycles,
};
