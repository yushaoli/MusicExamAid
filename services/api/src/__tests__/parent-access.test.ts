import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import type { ParentAccessOptions } from '../routes/parent-access';
import {
  buildSignedParentToken, parentSessionCookie, verifySignedParentToken,
} from '../auth/parent-session';
import { buildSignedFamilyToken, signSessionPayload } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const OPENID = 'synthetic_parent_openid';
const OTHER_OPENID = 'synthetic_other_parent';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY',
  'WECHAT_MINI_APPID', 'WECHAT_MINI_SECRET'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-parent-auth-key-at-least-32-bytes';
  process.env.WECHAT_MINI_APPID = 'synthetic-mini-appid';
  process.env.WECHAT_MINI_SECRET = 'synthetic-mini-secret';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

interface GrantRow {
  parent_openid: string;
  learner_id: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
}

function fakeGrantPool() {
  const grants = new Map<string, GrantRow>();
  const queries: Array<{text: string; values: unknown[]}> = [];
  const query = async (text: string, values: unknown[] = []) => {
    queries.push({text, values});
    const [openid, learnerId] = values.map(String);
    const key = `${openid}\0${learnerId}`;
    if (text.includes('INSERT INTO parent_learner_grants')) {
      const row = {parent_openid: openid, learner_id: learnerId,
        granted_by: 'family_admin', granted_at: new Date(), revoked_at: null};
      grants.set(key, row);
      return {rows: [], rowCount: 1};
    }
    if (text.includes('UPDATE parent_learner_grants')) {
      const row = grants.get(key);
      if (!row || row.revoked_at) return {rows: [], rowCount: 0};
      row.revoked_at = new Date();
      return {rows: [], rowCount: 1};
    }
    if (text.includes('SELECT learner_id FROM parent_learner_grants')) {
      return {rows: Array.from(grants.values())
        .filter(row => row.parent_openid === openid && !row.revoked_at)
        .map(row => ({learner_id: row.learner_id})), rowCount: 1};
    }
    if (text.includes('SELECT parent_openid, learner_id')) {
      return {rows: Array.from(grants.values()).filter(row => row.learner_id === openid), rowCount: 1};
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };
  return {
    pool: {query} as unknown as NonNullable<ParentAccessOptions['postgresPool']>,
    queryCount: () => queries.length,
  };
}

function countingStore() {
  let calls = 0;
  const target = new DomainRepository();
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
  authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'e'.repeat(32))}`,
});

function createLearner(store: DomainRepository, id = 'lrn_parent_grant'): void {
  store.createLearner({
    id, name_cn: '合成家长学员', gender: '女', dob: '2016-01-02', id_type: '身份证',
    id_number: '110101201601021234', guardian_phone: '13800138000',
  });
}

describe('parent identity and learner grants', () => {
  it('validates wx.login codes and provider configuration before any exchange', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('Unexpected fetch'); };
    const app = buildApp({parentAccess: {postgresPool: fakeGrantPool().pool}});
    try {
      const missing = await app.inject({method: 'POST', url: '/parent/auth', payload: {}});
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.headers['cache-control'], 'no-store');
      delete process.env.WECHAT_MINI_SECRET;
      const unconfigured = await app.inject({method: 'POST', url: '/parent/auth',
        payload: {code: 'synthetic-code'}});
      assert.equal(unconfigured.statusCode, 503);
      assert.equal(unconfigured.json().error, 'PARENT_AUTH_NOT_CONFIGURED');
      assert.equal(fetchCalls, 0);
    } finally {
      await app.close();
    }
  });

  it('exchanges codes server-side without returning OpenID or the WeChat session key', async () => {
    let providerUrl = '';
    globalThis.fetch = async input => {
      providerUrl = String(input);
      return new Response(JSON.stringify({openid: OPENID, session_key: 'provider-session-secret'}), {
        status: 200, headers: {'content-type': 'application/json'},
      });
    };
    const app = buildApp({parentAccess: {postgresPool: fakeGrantPool().pool}});
    try {
      const response = await app.inject({method: 'POST', url: '/parent/auth',
        payload: {code: 'synthetic-code'}});
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.role, 'parent');
      assert.equal(body.expires_in, 7200);
      assert.equal(body.openid, undefined);
      assert.equal(body.session_key, undefined);
      assert.equal(response.body.includes(OPENID), false);
      assert.equal(response.body.includes('provider-session-secret'), false);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(String(response.headers['set-cookie']), /mea_parent_session=.*HttpOnly; SameSite=Lax/);
      const url = new URL(providerUrl);
      assert.equal(url.origin, 'https://api.weixin.qq.com');
      assert.equal(url.pathname, '/sns/jscode2session');
      assert.equal(url.searchParams.get('js_code'), 'synthetic-code');
      assert.equal(verifySignedParentToken(body.parent_token)?.openid, OPENID);
    } finally {
      await app.close();
    }
  });

  it('fails closed for provider rejection, malformed responses and transport errors', async () => {
    const app = buildApp({parentAccess: {postgresPool: fakeGrantPool().pool}});
    try {
      for (const [payload, expected] of [
        [{errcode: 40029}, 401], [{errcode: 40029, openid: OPENID}, 401],
        [null, 502], [{openid: 'not valid!'}, 401],
      ] as const) {
        globalThis.fetch = async () => new Response(JSON.stringify(payload), {status: 200});
        const response = await app.inject({method: 'POST', url: '/parent/auth',
          payload: {code: 'synthetic-code'}});
        assert.equal(response.statusCode, expected, response.body);
      }
      globalThis.fetch = async () => { throw new Error('synthetic transport failure'); };
      const unavailable = await app.inject({method: 'POST', url: '/parent/auth',
        payload: {code: 'synthetic-code'}});
      assert.equal(unavailable.statusCode, 502);
    } finally {
      await app.close();
    }
  });

  it('accepts signed header, bearer and cookie sessions and rejects expired or tampered tokens', async () => {
    const {pool, queryCount} = fakeGrantPool();
    const app = buildApp({parentAccess: {postgresPool: pool}});
    const token = buildSignedParentToken(OPENID);
    try {
      const requests = [
        {'x-mea-parent-session': token},
        {authorization: `Bearer ${token}`},
        {cookie: parentSessionCookie(token).split(';')[0]},
      ];
      for (const headers of requests) {
        const response = await app.inject({method: 'GET', url: '/parent/session', headers});
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(response.json().learner_ids, []);
        assert.equal(response.json().openid, undefined);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(queryCount(), 3);

      const encoded = Buffer.from(OPENID).toString('base64url');
      const expiredPayload = `parent.v1.${encoded}.${Math.floor(Date.now() / 1000) - 1}`;
      const expired = `${expiredPayload}.${signSessionPayload(expiredPayload)}`;
      const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
      for (const invalid of [expired, tampered, 'parent.v1.malformed']) {
        assert.equal(verifySignedParentToken(invalid), null);
        const before = queryCount();
        const response = await app.inject({method: 'GET', url: '/parent/session',
          headers: {'x-mea-parent-session': invalid}});
        assert.equal(response.statusCode, 401);
        assert.equal(queryCount(), before);
      }
    } finally {
      await app.close();
    }
  });

  it('lets admins grant, list and revoke ownership with immediate effect', async () => {
    const store = new DomainRepository();
    createLearner(store);
    const {pool} = fakeGrantPool();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const grantUrl = '/parent/learners/lrn_parent_grant/grant';
    try {
      const granted = await app.inject({method: 'PUT', url: grantUrl,
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(granted.statusCode, 200, granted.body);
      assert.equal(granted.headers['cache-control'], 'no-store');
      assert.deepEqual((await app.inject({method: 'GET', url: '/parent/session',
        headers: parentHeaders()})).json().learner_ids, ['lrn_parent_grant']);
      assert.deepEqual((await app.inject({method: 'GET', url: '/parent/session',
        headers: parentHeaders(OTHER_OPENID)})).json().learner_ids, []);

      const listed = await app.inject({method: 'GET',
        url: '/parent/learners/lrn_parent_grant/grants', headers: familyHeaders()});
      assert.equal(listed.statusCode, 200);
      assert.equal(listed.json().items[0].parent_openid, OPENID);
      const revoked = await app.inject({method: 'DELETE', url: grantUrl,
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200);
      assert.equal(revoked.json().revoked, true);
      assert.deepEqual((await app.inject({method: 'GET', url: '/parent/session',
        headers: parentHeaders()})).json().learner_ids, []);
      const afterRevoke = await app.inject({method: 'GET',
        url: '/parent/learners/lrn_parent_grant/grants', headers: familyHeaders()});
      assert.ok(afterRevoke.json().items[0].revoked_at);
    } finally {
      await app.close();
    }
  });

  it('denies non-admin grant changes before repository, SQL or provider access', async () => {
    const {store, callCount} = countingStore();
    const {pool, queryCount} = fakeGrantPool();
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; throw new Error('Unexpected fetch'); };
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const requests = [
      {method: 'PUT' as const, url: '/parent/learners/lrn_parent_grant/grant',
        payload: {parent_openid: OPENID}},
      {method: 'DELETE' as const, url: '/parent/learners/lrn_parent_grant/grant',
        payload: {parent_openid: OPENID}},
      {method: 'GET' as const, url: '/parent/learners/lrn_parent_grant/grants'},
    ];
    try {
      for (const headers of [{}, teacherHeaders(), parentHeaders()]) {
        for (const request of requests) {
          const response = await app.inject({...request, headers});
          assert.equal(response.statusCode, 401, response.body);
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      const familyParentSession = await app.inject({method: 'GET', url: '/parent/session',
        headers: familyHeaders()});
      assert.equal(familyParentSession.statusCode, 401);
      assert.equal(callCount(), 0);
      assert.equal(queryCount(), 0);
      assert.equal(fetchCalls, 0);
    } finally {
      await app.close();
    }
  });
});
