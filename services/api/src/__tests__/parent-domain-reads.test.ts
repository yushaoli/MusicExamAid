import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import type { ParentAccessOptions } from '../routes/parent-access';
import { buildSignedParentToken } from '../auth/parent-session';
import { buildSignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const OPENID = 'synthetic_domain_parent';
const OTHER_OPENID = 'synthetic_ungranted_parent';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-parent-domain-key-at-least-32-bytes';
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fakeGrantPool() {
  const active = new Set<string>([`${OPENID}\0lrn_owned`]);
  let queryCount = 0;
  const query = async (text: string, values: unknown[] = []) => {
    queryCount += 1;
    const [openid, learnerId] = values.map(String);
    const key = `${openid}\0${learnerId}`;
    if (text.includes('SELECT learner_id FROM parent_learner_grants')) {
      const learnerIds = Array.from(active)
        .filter(entry => entry.startsWith(`${openid}\0`))
        .map(entry => entry.split('\0')[1]);
      return {rows: learnerIds.map(learner_id => ({learner_id})), rowCount: learnerIds.length};
    }
    if (text.includes('UPDATE parent_learner_grants')) {
      const existed = active.delete(key);
      return {rows: [], rowCount: existed ? 1 : 0};
    }
    if (text.includes('INSERT INTO parent_learner_grants')) {
      active.add(key);
      return {rows: [], rowCount: 1};
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };
  return {
    pool: {query} as unknown as NonNullable<ParentAccessOptions['postgresPool']>,
    queryCount: () => queryCount,
  };
}

function fixtureStore() {
  const target = new DomainRepository();
  for (const [id, name] of [['lrn_owned', '合成拥有学员'], ['lrn_other', '合成他人学员']] as const) {
    target.createLearner({
      id, name_cn: name, gender: '女', dob: '2016-01-02', id_type: '身份证',
      id_number: '110101201601021234', guardian_phone: '13800138000',
    });
  }
  for (const [id, learnerId] of [['reg_owned', 'lrn_owned'], ['reg_other', 'lrn_other']] as const) {
    target.createRegistration({
      id, learner_id: learnerId, institution_id: null, cycle_id: 'cycle_synthetic',
      subject_id: 'piano', level: 3, exam_mode: '现场', repertoire: ['合成曲目'],
    });
  }
  target.transitionRegistration({id: 'reg_owned', from_status: 'draft', to_status: 'submitted'});
  target.transitionRegistration({id: 'reg_owned', from_status: 'submitted', to_status: 'locked'});
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
  return {store, callCount: () => calls};
}

const parentHeaders = (openid = OPENID) => ({'x-mea-parent-session': buildSignedParentToken(openid)});
const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const teacherHeaders = () => ({
  authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'f'.repeat(32))}`,
});
const readRequests = [
  '/parent/learners', '/parent/learners/lrn_owned',
  '/parent/registrations', '/parent/registrations/reg_owned',
];

describe('grant-scoped parent learner and registration reads', () => {
  it('rejects missing and wrong-role credentials before SQL or repository access', async () => {
    const {store, callCount} = fixtureStore();
    const {pool, queryCount} = fakeGrantPool();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const headers of [{}, familyHeaders(), teacherHeaders()]) {
        for (const url of readRequests) {
          const response = await app.inject({method: 'GET', url, headers});
          assert.equal(response.statusCode, 401, `${url}: ${response.body}`);
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(queryCount(), 0);
      assert.equal(callCount(), 0);
    } finally {
      await app.close();
    }
  });

  it('returns only granted learner profiles and denies cross-owner IDs before repository reads', async () => {
    const {store, callCount} = fixtureStore();
    const {pool} = fakeGrantPool();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const listed = await app.inject({method: 'GET', url: '/parent/learners', headers: parentHeaders()});
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(listed.json().items.map((item: {id: string}) => item.id), ['lrn_owned']);
      assert.equal(listed.body.includes('id_number_encrypted'), false);
      assert.equal(listed.body.includes('lrn_other'), false);

      const owned = await app.inject({method: 'GET', url: '/parent/learners/lrn_owned',
        headers: parentHeaders()});
      assert.equal(owned.statusCode, 200);
      assert.equal(owned.json().name_cn, '合成拥有学员');
      assert.equal(owned.json().id_number_encrypted, undefined);
      const callsBeforeDeniedRead = callCount();
      const other = await app.inject({method: 'GET', url: '/parent/learners/lrn_other',
        headers: parentHeaders()});
      assert.equal(other.statusCode, 404);
      assert.equal(other.body.includes('合成他人学员'), false);
      assert.equal(callCount(), callsBeforeDeniedRead);

      const noGrants = await app.inject({method: 'GET', url: '/parent/learners',
        headers: parentHeaders(OTHER_OPENID)});
      assert.deepEqual(noGrants.json().items, []);
      assert.equal(callCount(), callsBeforeDeniedRead);
    } finally {
      await app.close();
    }
  });

  it('filters registration lists and details by learner grants without exposing snapshots', async () => {
    const {store} = fixtureStore();
    const {pool} = fakeGrantPool();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const listed = await app.inject({method: 'GET', url: '/parent/registrations',
        headers: parentHeaders()});
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(listed.json().items.map((item: {id: string}) => item.id), ['reg_owned']);
      assert.equal(listed.body.includes('reg_other'), false);
      assert.equal(listed.body.includes('snapshot_json'), false);

      const owned = await app.inject({method: 'GET', url: '/parent/registrations/reg_owned',
        headers: parentHeaders()});
      assert.equal(owned.statusCode, 200, owned.body);
      assert.equal(owned.json().id, 'reg_owned');
      assert.equal(owned.json().has_snapshot, true);
      assert.equal(owned.json().snapshot_json, undefined);
      assert.equal(owned.json().history, undefined);

      const other = await app.inject({method: 'GET', url: '/parent/registrations/reg_other',
        headers: parentHeaders()});
      assert.equal(other.statusCode, 404);
      assert.equal(other.body.includes('lrn_other'), false);
      assert.equal(other.body.includes('reg_other'), false);
      const noGrants = await app.inject({method: 'GET', url: '/parent/registrations/reg_owned',
        headers: parentHeaders(OTHER_OPENID)});
      assert.equal(noGrants.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it('removes learner and registration access immediately after grant revocation', async () => {
    const {store, callCount} = fixtureStore();
    const {pool} = fakeGrantPool();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      const revoked = await app.inject({method: 'DELETE',
        url: '/parent/learners/lrn_owned/grant', headers: familyHeaders(),
        payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200, revoked.body);
      assert.equal(revoked.json().revoked, true);
      const callsAfterRevoke = callCount();
      for (const url of ['/parent/learners/lrn_owned', '/parent/registrations/reg_owned']) {
        const response = await app.inject({method: 'GET', url, headers: parentHeaders()});
        assert.equal(response.statusCode, 404, response.body);
      }
      for (const url of ['/parent/learners', '/parent/registrations']) {
        const response = await app.inject({method: 'GET', url, headers: parentHeaders()});
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().items, []);
      }
      assert.equal(callCount(), callsAfterRevoke);
    } finally {
      await app.close();
    }
  });
});
