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

const OPENID = 'synthetic_profile_parent';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-parent-profile-key-at-least-32-bytes';
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
    target.createLearner({
      id, name_cn: '合成学员', name_en_optional: 'Synthetic', gender: '女',
      dob: '2016-01-02', id_type: '身份证', id_number: '110101201601021234',
      guardian_phone: '13800138000', ethnicity_optional: '合成民族',
      mailing_address_optional: '合成地址', recipient_name_optional: '合成收件人',
      recipient_phone_optional: '13800138001',
    });
  }
  target.setLearnerPhoto('lrn_owned', Buffer.from('synthetic portrait'));
  target.createRegistration({id: 'reg_locked', learner_id: 'lrn_owned',
    cycle_id: 'synthetic_cycle', subject_id: 'piano', level: 3, repertoire: ['合成曲目']});
  target.transitionRegistration({id: 'reg_locked', from_status: 'draft', to_status: 'submitted'});
  target.transitionRegistration({id: 'reg_locked', from_status: 'submitted', to_status: 'locked'});

  const active = new Set([`${OPENID}\0lrn_owned`, `${OPENID}\0lrn_missing`]);
  let queries = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    queries += 1;
    const [openid, learnerId] = values.map(String);
    if (sql.includes('SELECT learner_id FROM parent_learner_grants')) {
      return {rows: Array.from(active).filter(entry => entry.startsWith(`${openid}\0`))
        .map(entry => ({learner_id: entry.split('\0')[1]}))};
    }
    if (sql.includes('UPDATE parent_learner_grants')) {
      return {rows: [], rowCount: active.delete(`${openid}\0${learnerId}`) ? 1 : 0};
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const pool = {query} as unknown as NonNullable<ParentAccessOptions['postgresPool']>;
  let calls = 0;
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls += 1;
        return Reflect.apply(value, object, args);
      };
    },
  });
  return {store, target, pool, queryCount: () => queries, callCount: () => calls};
}

const parentHeaders = (openid = OPENID) => ({'x-mea-parent-session': buildSignedParentToken(openid)});
const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});

describe('grant-scoped parent learner profile writes', () => {
  it('rejects wrong-role, missing, expired and forged sessions before grant or repository access', async () => {
    const {store, pool, queryCount, callCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const expiredPayload = `parent.v1.${Buffer.from(OPENID).toString('base64url')}.${Math.floor(Date.now() / 1000) - 1}`;
    const expired = `${expiredPayload}.${signSessionPayload(expiredPayload)}`;
    try {
      for (const headers of [
        {}, familyHeaders(),
        {authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32))}`},
        {'x-mea-parent-session': expired},
        {'x-mea-parent-session': buildSignedParentToken(OPENID) + 'x'},
      ]) {
        const response = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
          headers, payload: {name_cn: '合成修改'}});
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(queryCount(), 0);
      assert.equal(callCount(), 0);
    } finally { await app.close(); }
  });

  it('denies cross-owner and unknown learner IDs before repository access regardless of supplied identity', async () => {
    const {store, target, pool, callCount} = fixture();
    const before = JSON.stringify(target.listLearners());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const id of ['lrn_other', 'lrn_unknown']) {
        const response = await app.inject({method: 'PATCH', url: `/parent/learners/${id}`,
          headers: parentHeaders(), payload: {name_cn: '合成修改',
            learner_id: 'lrn_owned', parent_openid: OPENID}});
        assert.equal(response.statusCode, 404);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json(), {error: 'LEARNER_NOT_FOUND'});
      }
      const ungranted = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
        headers: parentHeaders('synthetic_other_parent'), payload: {name_cn: '合成修改'}});
      assert.equal(ungranted.statusCode, 404);
      assert.equal(callCount(), 0);
      assert.equal(JSON.stringify(target.listLearners()), before);
    } finally { await app.close(); }
  });

  it('keeps learner creation, document upsert and photo writes behind admin authentication', async () => {
    const {store, pool, callCount, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const url of ['/learners', '/learners/lrn_owned/photo', '/rpc/learnerUpsert']) {
        const response = await app.inject({method: 'POST', url, headers: parentHeaders(),
          payload: {learner_id: 'lrn_owned', id_number: 'forged', photo_base64: 'Zm9yZ2Vk'}});
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(callCount(), 0);
      assert.equal(queryCount(), 0);
    } finally { await app.close(); }
  });

  it('patches profiles without replacing identifiers, omitted fields, portraits or locked snapshots', async () => {
    const {store, target, pool} = fixture();
    const before = {...target.getLearner('lrn_owned')!};
    const lockedBefore = JSON.stringify(target.getRegistration('reg_locked'));
    const historyBefore = JSON.stringify(target.getStatusHistory('reg_locked'));
    const photosBefore = target.getPortraitPhotosByLast4();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const patch = {name_cn: '合成新姓名', gender: '男', dob: '2016-02-29',
        guardian_phone: '13900139000', mailing_address_optional: '合成新地址',
        recipient_name_optional: '', recipient_phone_optional: '13900139001'};
      const response = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
        headers: parentHeaders(), payload: patch});
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers['cache-control'], 'no-store');
      const updated = target.getLearner('lrn_owned')!;
      assert.deepEqual(updated, {...before, ...patch, updated_at: updated.updated_at});
      assert.equal(response.json().id_number_encrypted, undefined);
      assert.equal(response.json().id_number, undefined);
      assert.equal(response.json().id_last4, '1234');
      const reloaded = await app.inject({method: 'GET', url: '/parent/learners/lrn_owned',
        headers: parentHeaders()});
      for (const [field, value] of Object.entries(patch)) assert.equal(reloaded.json()[field], value);
      assert.equal(reloaded.json().ethnicity_optional, before.ethnicity_optional);
      assert.equal(JSON.stringify(target.getRegistration('reg_locked')), lockedBefore);
      assert.equal(JSON.stringify(target.getStatusHistory('reg_locked')), historyBefore);
      assert.deepEqual(target.getPortraitPhotosByLast4(), photosBefore);
      assert.equal(target.getLearner('lrn_other')?.name_cn, '合成学员');

      const missing = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_missing',
        headers: parentHeaders(), payload: {name_cn: '合成缺失学员'}});
      assert.equal(missing.statusCode, 404);
      assert.equal(target.listLearners().length, 2);
    } finally { await app.close(); }
  });

  it('rejects malformed and protected fields atomically before any repository write', async () => {
    const {store, target, pool, callCount} = fixture();
    const before = JSON.stringify(target.listLearners());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const payload of [
        {}, [], {name_cn: 123}, {name_cn: ' '}, {gender: 'unknown'},
        {dob: '2017-02-29'}, {dob: '2016-2-2'}, {guardian_phone: ''},
        {recipient_name_optional: null}, {mailing_address_optional: 'x'.repeat(501)},
        ...['id', 'learner_id', 'id_type', 'id_number', 'id_number_encrypted', 'id_last4',
          'has_portrait_photo', 'created_at', 'updated_at', 'parent_openid', 'persist_db', 'persist_s3']
          .map(field => ({name_cn: '合成修改', [field]: 'forged'})),
      ]) {
        const response = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
          headers: parentHeaders(), payload});
        assert.equal(response.statusCode, 400, JSON.stringify(payload));
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(callCount(), 0);
      assert.equal(JSON.stringify(target.listLearners()), before);
    } finally { await app.close(); }
  });

  it('stops edits immediately after revocation and fails closed when grant storage is unavailable', async () => {
    const {store, target, pool, callCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const revoked = await app.inject({method: 'DELETE', url: '/parent/learners/lrn_owned/grant',
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200);
      const beforeCalls = callCount();
      const before = JSON.stringify(target.getLearner('lrn_owned'));
      const denied = await app.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
        headers: parentHeaders(), payload: {name_cn: '合成修改'}});
      assert.equal(denied.statusCode, 404);
      assert.equal(callCount(), beforeCalls);
      assert.equal(JSON.stringify(target.getLearner('lrn_owned')), before);
    } finally { await app.close(); }

    const unavailable = fixture();
    const brokenPool = {query: async () => { throw new Error('synthetic grant store unavailable'); }};
    const brokenApp = buildApp({store: unavailable.store,
      parentAccess: {postgresPool: brokenPool as unknown as ParentAccessOptions['postgresPool']}});
    try {
      const response = await brokenApp.inject({method: 'PATCH', url: '/parent/learners/lrn_owned',
        headers: parentHeaders(), payload: {name_cn: '合成修改'}});
      assert.equal(response.statusCode, 500);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(unavailable.callCount(), 0);
    } finally { await brokenApp.close(); }
  });

  it('routes Mini Program saves through the scoped PATCH with no CloudBase fallback', async () => {
    const source = readFileSync(resolve(__dirname,
      '../../../../apps/wechat-mini/miniprogram/utils/api.js'), 'utf8')
      .replace(/^export const /gm, 'const ').replace(/^export default /m, 'globalThis.api = ');
    const requests: Array<Record<string, any>> = [];
    let cloudCalls = 0;
    let mode = 'success';
    const context: Record<string, any> = {wx: {
      getStorageSync: (key: string) => key === 'MEA_PARENT_SESSION' ? 'synthetic-token' : '',
      cloud: {callFunction: () => { cloudCalls += 1; }},
      request: (request: Record<string, any>) => {
        requests.push(request);
        if (mode === 'network') return request.fail({errMsg: 'synthetic network failure'});
        request.success({statusCode: mode === 'denied' ? 404 : 200,
          data: mode === 'denied' ? {error: 'LEARNER_NOT_FOUND'} : {id: 'lrn_owned', name_cn: '合成修改'}});
      },
    }};
    runInNewContext(source, context);
    const result = await context.api.learnerUpsert({learner_id: 'lrn_owned', name_cn: '合成修改',
      id_number: '', id_type: '身份证', id: 'lrn_other', has_portrait_photo: true});
    assert.equal(result._id, 'lrn_owned');
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].url, 'https://mea.xgar.com.cn/parent/learners/lrn_owned');
    assert.equal(requests[0].header['X-Mea-Parent-Session'], 'synthetic-token');
    assert.equal(JSON.stringify(requests[0].data), JSON.stringify({name_cn: '合成修改'}));
    await assert.rejects(context.api.learnerUpsert({name_cn: '合成新学员'}), /管理员/);
    await assert.rejects(context.api.learnerUpsert({learner_id: 'lrn_owned', id_number: 'forged'}), /证件号码/);
    assert.equal(requests.length, 1);
    mode = 'denied';
    await assert.rejects(context.api.learnerUpsert({learner_id: 'lrn_owned', name_cn: '合成修改'}), /LEARNER_NOT_FOUND/);
    mode = 'network';
    await assert.rejects(context.api.learnerUpsert({learner_id: 'lrn_owned', name_cn: '合成修改'}), /network failure/);
    assert.equal(cloudCalls, 0);
  });
});
