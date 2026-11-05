import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import type { ParentAccessOptions } from '../routes/parent-access';
import { buildSignedParentToken } from '../auth/parent-session';
import { buildSignedFamilyToken, signSessionPayload } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const OPENID = 'synthetic_registration_editor';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-registration-edit-key-at-least-32-bytes';
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fixture() {
  const target = new DomainRepository();
  for (const id of ['lrn_owned', 'lrn_other']) {
    target.createLearner({id, name_cn: '合成学员', gender: '女', dob: '2016-01-02',
      id_type: '身份证', id_number: '110101201601021234', guardian_phone: '13800138000'});
  }
  for (const id of ['draft', 'needs_change', 'returned', 'submitted', 'confirmed', 'locked', 'other']) {
    target.createRegistration({id: `reg_${id}`, learner_id: id === 'other' ? 'lrn_other' : 'lrn_owned',
      institution_id: 'inst_synthetic', teacher_id: 'tch_synthetic', cycle_id: 'cycle_synthetic',
      subject_id: 'piano', level: 3, exam_mode: '现场', exam_site_id_optional: 'site_synthetic',
      repertoire: ['合成曲目一', '合成曲目二', '合成曲目三']});
    if (id === 'draft' || id === 'other') continue;
    target.transitionRegistration({id: `reg_${id}`, from_status: 'draft', to_status: 'submitted'});
    if (id === 'needs_change') target.transitionRegistration({id: `reg_${id}`, to_status: 'needs_change'});
    if (id === 'confirmed') target.transitionRegistration({id: `reg_${id}`, to_status: 'confirmed'});
    if (id === 'locked' || id === 'returned') target.transitionRegistration({id: `reg_${id}`, to_status: 'locked'});
    if (id === 'returned') target.transitionRegistration({id: `reg_${id}`, to_status: 'needs_change', teacher_notes: '合成修改要求'});
  }
  const active = new Set([OPENID]);
  let queries = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    queries += 1;
    if (sql.includes('SELECT learner_id FROM parent_learner_grants')) {
      return {rows: active.has(String(values[0])) ? [{learner_id: 'lrn_owned'}] : []};
    }
    if (sql.includes('UPDATE parent_learner_grants')) {
      return {rows: [], rowCount: active.delete(String(values[0])) ? 1 : 0};
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const pool = {query} as unknown as NonNullable<ParentAccessOptions['postgresPool']>;
  const calls: string[] = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return Reflect.apply(value, object, args);
      };
    },
  });
  return {store, target, pool, calls, queryCount: () => queries};
}

const parentHeaders = (openid = OPENID) => ({'x-mea-parent-session': buildSignedParentToken(openid)});
const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});

describe('grant-scoped parent registration edits', () => {
  it('rejects missing, wrong-role, forged and expired sessions before storage access', async () => {
    const {store, pool, calls, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const expiredPayload = `parent.v1.${Buffer.from(OPENID).toString('base64url')}.${Math.floor(Date.now() / 1000) - 1}`;
    try {
      for (const headers of [{}, familyHeaders(),
        {authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32))}`},
        {'x-mea-parent-session': buildSignedParentToken(OPENID) + 'x'},
        {'x-mea-parent-session': `${expiredPayload}.${signSessionPayload(expiredPayload)}`},
      ]) {
        const response = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
          headers, payload: {level: 4}});
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(queryCount(), 0);
      assert.deepEqual(calls, []);
    } finally { await app.close(); }
  });

  it('denies cross-owner, missing and ungranted records without exposing or mutating them', async () => {
    const {store, target, pool, calls} = fixture();
    const before = JSON.stringify(target.listRegistrations());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const id of ['reg_other', 'reg_unknown']) {
        const response = await app.inject({method: 'PATCH', url: `/parent/registrations/${id}`,
          headers: parentHeaders(), payload: {level: 4, learner_id: 'lrn_owned', parent_openid: OPENID}});
        assert.equal(response.statusCode, 404);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json(), {error: 'REGISTRATION_NOT_FOUND'});
      }
      assert.deepEqual(calls, ['getRegistration', 'getRegistration']);
      const response = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders('synthetic_ungranted_parent'), payload: {level: 4}});
      assert.equal(response.statusCode, 404);
      assert.equal(calls.length, 2);
      assert.equal(JSON.stringify(target.listRegistrations()), before);
    } finally { await app.close(); }
  });

  it('edits draft and returned details without replacing omitted fields, ownership, status or history', async () => {
    const {store, target, pool} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const id of ['reg_draft', 'reg_needs_change', 'reg_returned']) {
        const before = structuredClone(target.getRegistration(id)!);
        const historyBefore = JSON.stringify(target.getStatusHistory(id));
        const patch = {level: 4, exam_mode: '视频', exam_site_id_optional: '', repertoire: ['合成新曲目']};
        const response = await app.inject({method: 'PATCH', url: `/parent/registrations/${id}`,
          headers: parentHeaders(), payload: patch});
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
        const updated = target.getRegistration(id)!;
        assert.deepEqual(updated, {...before, ...patch, updated_at: updated.updated_at});
        assert.equal(JSON.stringify(target.getStatusHistory(id)), historyBefore);
        assert.equal(response.json().snapshot_json, undefined);
        assert.equal(response.json().history, undefined);
        assert.equal(response.json().has_snapshot, before.snapshot_json !== null);
      }
      const onlySubject = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders(), payload: {subject_id: 'violin'}});
      assert.equal(onlySubject.statusCode, 200);
      assert.equal(onlySubject.json().subject_name, '小提琴');
      assert.deepEqual(target.getRegistration('reg_draft')?.repertoire, ['合成新曲目']);
      const cleared = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_needs_change',
        headers: parentHeaders(), payload: {repertoire: []}});
      assert.equal(cleared.statusCode, 200);
      assert.deepEqual(target.getRegistration('reg_needs_change')?.repertoire, []);

      const submitted = await app.inject({method: 'POST', url: '/parent/registrations/reg_returned/submit',
        headers: parentHeaders(), payload: {}});
      assert.equal(submitted.statusCode, 200);
      assert.equal(submitted.json().status, 'submitted');
    } finally { await app.close(); }
  });

  it('blocks submitted, confirmed and locked edits without changing snapshots or history', async () => {
    const {store, target, pool, calls} = fixture();
    const before = JSON.stringify(target.listRegistrations());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const id of ['reg_submitted', 'reg_confirmed', 'reg_locked']) {
        const historyBefore = JSON.stringify(target.getStatusHistory(id));
        const response = await app.inject({method: 'PATCH', url: `/parent/registrations/${id}`,
          headers: parentHeaders(), payload: {level: 4}});
        assert.equal(response.statusCode, 409, response.body);
        assert.deepEqual(response.json(), {error: 'REGISTRATION_NOT_EDITABLE'});
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(JSON.stringify(target.getStatusHistory(id)), historyBefore);
        assert.throws(() => target.updateRegistrationDetails(id, {level: 4}), /current status/);
      }
      assert.equal(calls.includes('updateRegistrationDetails'), false);
      assert.equal(JSON.stringify(target.listRegistrations()), before);
    } finally { await app.close(); }
  });

  it('rejects protected fields and invalid values before mutation, including mixed valid and invalid patches', async () => {
    const {store, target, pool, calls} = fixture();
    const before = JSON.stringify(target.listRegistrations());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const payload of [{}, [], {level: '4'}, {level: true}, {level: 0}, {level: 11}, {level: 1.5},
        {subject_id: ''}, {subject_id: ' '}, {subject_id: 'x'.repeat(129)}, {exam_mode: '线上'},
        {exam_site_id_optional: null}, {exam_site_id_optional: 'x'.repeat(129)},
        {repertoire: 'forged'}, {repertoire: [3]}, {repertoire: [' ']},
        {repertoire: Array(21).fill('曲目')}, {repertoire: ['x'.repeat(501)]},
        ...['id', 'reg_id', 'learner_id', 'institution_id', 'teacher_id', 'cycle_id', 'status',
          'workflow_status', 'teacher_notes', 'snapshot_json', 'missing_flags', 'locked_at',
          'created_at', 'updated_at', 'parent_openid', 'persist_db']
          .map(field => ({level: 4, [field]: 'forged'})),
      ]) {
        const response = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
          headers: parentHeaders(), payload});
        assert.equal(response.statusCode, 400, JSON.stringify(payload));
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(calls.includes('updateRegistrationDetails'), false);
      assert.equal(JSON.stringify(target.listRegistrations()), before);
    } finally { await app.close(); }
  });

  it('protects checkout pricing while permitting corrections that keep the paid level', async () => {
    const {store, target, pool} = fixture();
    const checkout = target.payRegistrationOrder({registration_id: 'reg_draft'});
    const orderBefore = JSON.stringify(checkout.order);
    const registrationBefore = JSON.stringify(target.getRegistration('reg_draft'));
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const denied = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders(), payload: {level: 4, repertoire: ['合成修改']}});
      assert.equal(denied.statusCode, 409, denied.body);
      assert.deepEqual(denied.json(), {error: 'REGISTRATION_PRICE_LOCKED'});
      assert.equal(denied.headers['cache-control'], 'no-store');
      assert.equal(JSON.stringify(target.getRegistration('reg_draft')), registrationBefore);
      assert.throws(() => target.updateRegistrationDetails('reg_draft', {level: 4}), /checkout/);
      const corrected = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders(), payload: {level: 3, repertoire: ['合成修改']}});
      assert.equal(corrected.statusCode, 200, corrected.body);
      assert.deepEqual(corrected.json().repertoire, ['合成修改']);
      assert.equal(JSON.stringify(checkout.order), orderBefore);
    } finally { await app.close(); }
  });

  it('honors revocation and grant-store failure and keeps legacy RPC edits closed to parents', async () => {
    const {store, target, pool, calls} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const before = JSON.stringify(target.listRegistrations());
    try {
      const rpc = await app.inject({method: 'POST', url: '/rpc/registrationUpdate',
        headers: parentHeaders(), payload: {reg_id: 'reg_draft', level: 4}});
      assert.equal(rpc.statusCode, 401);
      const revoked = await app.inject({method: 'DELETE', url: '/parent/learners/lrn_owned/grant',
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200);
      const callCount = calls.length;
      const response = await app.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders(), payload: {level: 4}});
      assert.equal(response.statusCode, 404);
      assert.equal(calls.length, callCount);
      assert.equal(JSON.stringify(target.listRegistrations()), before);
    } finally { await app.close(); }
    const unavailable = fixture();
    const brokenPool = {query: async () => { throw new Error('synthetic grant store unavailable'); }};
    const brokenApp = buildApp({store: unavailable.store,
      parentAccess: {postgresPool: brokenPool as unknown as ParentAccessOptions['postgresPool']}});
    try {
      const response = await brokenApp.inject({method: 'PATCH', url: '/parent/registrations/reg_draft',
        headers: parentHeaders(), payload: {level: 4}});
      assert.equal(response.statusCode, 500);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(unavailable.calls, []);
    } finally { await brokenApp.close(); }
  });

  it('sends Mini Program edits as scoped PATCH with numeric level and no CloudBase fallback', async () => {
    const source = readFileSync(resolve(__dirname, '../../../../apps/wechat-mini/miniprogram/utils/api.js'), 'utf8')
      .replace(/^export const /gm, 'const ').replace(/^export default /m, 'globalThis.api = ');
    const requests: Array<Record<string, any>> = [];
    let mode = 'success';
    let cloudCalls = 0;
    const context: Record<string, any> = {wx: {
      getStorageSync: (key: string) => key === 'MEA_PARENT_SESSION' ? 'synthetic-token' : '',
      cloud: {callFunction: () => { cloudCalls += 1; }},
      request: (request: Record<string, any>) => {
        requests.push(request);
        if (mode === 'network') return request.fail({errMsg: 'synthetic network failure'});
        request.success({statusCode: mode === 'denied' ? 409 : 200,
          data: mode === 'denied' ? {error: 'REGISTRATION_NOT_EDITABLE'} : {id: 'reg_draft', status: 'draft'}});
      },
    }};
    runInNewContext(source, context);
    const updated = await context.api.registrationUpdate({reg_id: 'reg_draft', level: '4',
      learner_id: 'lrn_other', status: 'locked'});
    assert.equal(updated._id, 'reg_draft');
    assert.equal(updated.workflow_status, 'draft');
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].url, 'https://mea.xgar.com.cn/parent/registrations/reg_draft');
    assert.equal(requests[0].header['X-Mea-Parent-Session'], 'synthetic-token');
    assert.equal(JSON.stringify(requests[0].data), JSON.stringify({level: 4}));
    await assert.rejects(context.api.registrationUpdate({level: 4}), /编号/);
    assert.equal(requests.length, 1);
    mode = 'denied';
    await assert.rejects(context.api.registrationUpdate({reg_id: 'reg_draft', level: 4}), /NOT_EDITABLE/);
    mode = 'network';
    await assert.rejects(context.api.registrationUpdate({reg_id: 'reg_draft', level: 4}), /network failure/);
    assert.equal(cloudCalls, 0);
  });

  it('waits for an editable record to load and preserves repertoire beyond the two visible inputs', async () => {
    const source = readFileSync(resolve(__dirname,
      '../../../../apps/wechat-mini/miniprogram/pages/registration/edit/edit.js'), 'utf8')
      .replace("import api from '../../../utils/api';", 'const api = globalThis.mockApi;');
    for (const state of ['draft', 'needs_change', 'locked', 'load_failure']) {
      const updates: Array<Record<string, any>> = [];
      let page: any;
      const context = {
        getApp: () => ({ensureLogin: async () => {}}),
        Page: (definition: unknown) => { page = definition; },
        setTimeout: () => 0,
        wx: {showToast: () => {}},
        mockApi: {
          learnerList: async () => [{_id: 'lrn_owned', name_cn: '合成学员'}, {_id: 'lrn_other'}],
          getDictSubjects: async () => [{subject_id: 'piano', subject_name: '钢琴'}],
          getDictCycles: async () => [{cycle_id: 'cycle_synthetic'}, {cycle_id: 'cycle_other'}],
          registrationGet: async () => {
            if (state === 'load_failure') throw new Error('synthetic unavailable');
            return {id: 'reg_synthetic', learner_id: 'lrn_owned', cycle_id: 'cycle_synthetic',
              subject_id: 'piano', level: 3, exam_mode: '视频', status: state,
              repertoire: ['曲目一', '曲目二', '曲目三', '曲目四']};
          },
          registrationUpdate: async (patch: Record<string, any>) => { updates.push(patch); },
        },
      };
      runInNewContext(source, context);
      page.data = structuredClone(page.data);
      page.setData = (patch: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(patch)) {
          const path = key.split('.');
          let target = page.data;
          for (const segment of path.slice(0, -1)) target = target[segment];
          target[path[path.length - 1]] = value;
        }
      };
      await page.onSave();
      assert.equal(updates.length, 0);
      await page.onLoad({id: 'reg_synthetic'});
      await page.onSave();
      if (state === 'locked' || state === 'load_failure') {
        assert.equal(updates.length, 0);
        assert.equal(page.data.loadFailed, state === 'load_failure');
      } else {
        assert.equal(updates.length, 1);
        assert.equal(JSON.stringify(updates[0].repertoire), JSON.stringify(['曲目一', '曲目二', '曲目三', '曲目四']));
        assert.equal(updates[0].exam_mode, '视频');
        page.onLearnerChange({detail: {value: 1}});
        page.onCycleChange({detail: {value: 1}});
        assert.equal(page.data.form.learner_id, 'lrn_owned');
        assert.equal(page.data.form.cycle_id, 'cycle_synthetic');
      }
    }
  });
});
