import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import type { ParentAccessOptions } from '../routes/parent-access';
import { buildSignedParentToken } from '../auth/parent-session';
import { buildSignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const OPENID = 'synthetic_write_parent';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-parent-write-key-at-least-32-bytes';
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fixture() {
  const target = new DomainRepository();
  for (const [id, name] of [['lrn_owned', '合成写入学员'], ['lrn_other', '合成其他学员']] as const) {
    target.createLearner({
      id, name_cn: name, gender: '女', dob: '2016-01-02', id_type: '身份证',
      id_number: '110101201601021234', guardian_phone: '13800138000',
    });
  }
  target.createRegistration({
    id: 'reg_other', learner_id: 'lrn_other', cycle_id: 'cycle_synthetic',
    subject_id: 'piano', level: 3, exam_mode: '现场', repertoire: [],
  });
  target.createRegistration({
    id: 'reg_locked', learner_id: 'lrn_owned', cycle_id: 'cycle_synthetic',
    subject_id: 'piano', level: 3, exam_mode: '现场', repertoire: ['合成曲目'],
  });
  target.transitionRegistration({id: 'reg_locked', from_status: 'draft', to_status: 'submitted'});
  target.transitionRegistration({id: 'reg_locked', from_status: 'submitted', to_status: 'locked'});

  const active = new Set([`${OPENID}\0lrn_owned`]);
  let queries = 0;
  const query = async (text: string, values: unknown[] = []) => {
    queries += 1;
    const [openid, learnerId] = values.map(String);
    if (text.includes('SELECT learner_id FROM parent_learner_grants')) {
      const learnerIds = Array.from(active)
        .filter(entry => entry.startsWith(`${openid}\0`))
        .map(entry => entry.split('\0')[1]);
      return {rows: learnerIds.map(learner_id => ({learner_id})), rowCount: learnerIds.length};
    }
    if (text.includes('UPDATE parent_learner_grants')) {
      const existed = active.delete(`${openid}\0${learnerId}`);
      return {rows: [], rowCount: existed ? 1 : 0};
    }
    throw new Error(`Unexpected SQL: ${text}`);
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
  return {store, pool, callCount: () => calls, queryCount: () => queries};
}

const parentHeaders = () => ({'x-mea-parent-session': buildSignedParentToken(OPENID)});
const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const teacherHeaders = () => ({
  authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32))}`,
});
const createPayload = (learner_id = 'lrn_owned') => ({
  learner_id, cycle_id: 'cycle_synthetic', subject_id: 'piano', level: 3,
  exam_mode: '现场', repertoire: ['合成新曲目'],
});

describe('grant-scoped parent registration writes', () => {
  it('rejects missing and wrong-role credentials before SQL or repository access', async () => {
    const {store, pool, callCount, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const requests = [
      {url: '/parent/registrations', payload: createPayload()},
      {url: '/parent/registrations/reg_locked/submit', payload: {}},
    ];
    try {
      for (const headers of [{}, familyHeaders(), teacherHeaders()]) {
        for (const request of requests) {
          const response = await app.inject({method: 'POST', ...request, headers});
          assert.equal(response.statusCode, 401, response.body);
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(queryCount(), 0);
      assert.equal(callCount(), 0);
    } finally {
      await app.close();
    }
  });

  it('rejects cross-owner creation and submission without mutating records', async () => {
    const {store, pool, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const created = await app.inject({method: 'POST', url: '/parent/registrations',
        headers: parentHeaders(), payload: createPayload('lrn_other')});
      assert.equal(created.statusCode, 404);
      const submitted = await app.inject({method: 'POST',
        url: '/parent/registrations/reg_other/submit', headers: parentHeaders(), payload: {}});
      assert.equal(submitted.statusCode, 404);
      assert.equal(store.listRegistrations().length, 2);
      assert.equal(store.getRegistration('reg_other')?.status, 'draft');

      const beforeValidation = queryCount();
      const badLevel = await app.inject({method: 'POST', url: '/parent/registrations',
        headers: parentHeaders(), payload: {...createPayload(), level: 11}});
      assert.equal(badLevel.statusCode, 400);
      assert.equal(queryCount(), beforeValidation);
    } finally {
      await app.close();
    }
  });

  it('creates and submits owned registrations only through valid state transitions', async () => {
    const {store, pool} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const created = await app.inject({method: 'POST', url: '/parent/registrations',
        headers: parentHeaders(), payload: createPayload()});
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().learner_id, 'lrn_owned');
      assert.equal(created.json().status, 'draft');
      assert.equal(created.json().snapshot_json, undefined);
      const id = created.json().id as string;

      const submitted = await app.inject({method: 'POST',
        url: `/parent/registrations/${id}/submit`, headers: parentHeaders(), payload: {}});
      assert.equal(submitted.statusCode, 200, submitted.body);
      assert.equal(submitted.json().status, 'submitted');
      const repeated = await app.inject({method: 'POST',
        url: `/parent/registrations/${id}/submit`, headers: parentHeaders(), payload: {}});
      assert.equal(repeated.statusCode, 409);
      const locked = await app.inject({method: 'POST',
        url: '/parent/registrations/reg_locked/submit', headers: parentHeaders(), payload: {}});
      assert.equal(locked.statusCode, 409);

      const needsChange = store.createRegistration({
        id: 'reg_needs_change', learner_id: 'lrn_owned', cycle_id: 'cycle_synthetic',
        subject_id: 'piano', level: 3, exam_mode: '现场', repertoire: [],
      });
      store.transitionRegistration({id: needsChange.id, from_status: 'draft', to_status: 'submitted'});
      store.transitionRegistration({id: needsChange.id, from_status: 'submitted', to_status: 'needs_change'});
      const resubmitted = await app.inject({method: 'POST',
        url: '/parent/registrations/reg_needs_change/submit', headers: parentHeaders(), payload: {}});
      assert.equal(resubmitted.statusCode, 200, resubmitted.body);
      assert.equal(resubmitted.json().status, 'submitted');
    } finally {
      await app.close();
    }
  });

  it('blocks creation and submission immediately after revocation', async () => {
    const {store, pool, callCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const revoked = await app.inject({method: 'DELETE', url: '/parent/learners/lrn_owned/grant',
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200);
      const callsAfterRevoke = callCount();
      const created = await app.inject({method: 'POST', url: '/parent/registrations',
        headers: parentHeaders(), payload: createPayload()});
      assert.equal(created.statusCode, 404);
      const submitted = await app.inject({method: 'POST',
        url: '/parent/registrations/reg_locked/submit', headers: parentHeaders(), payload: {}});
      assert.equal(submitted.statusCode, 404);
      assert.equal(callCount(), callsAfterRevoke);
      assert.equal(store.listRegistrations().length, 2);
    } finally {
      await app.close();
    }
  });
});
