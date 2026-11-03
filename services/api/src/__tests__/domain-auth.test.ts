import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import { buildSignedFamilyToken, familySessionCookie } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY',
  'ENABLE_LIVE_STORAGE', 'WECOM_RELAY_TOKEN'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-domain-auth-key-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
  delete process.env.WECOM_RELAY_TOKEN;
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const familyToken = () => buildSignedFamilyToken();
const teacherToken = () => buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32));
const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]).toString('base64');
const learnerPayload = {
  name_cn: '合成域学员', gender: '女', dob: '2016-01-02', id_type: '身份证',
  id_number: '110101201601021234', guardian_phone: '13800138000',
};

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

describe('learner, registration and archive authorization', () => {
  it('denies anonymous and teacher credentials before every direct, RPC and indirect repository access', async () => {
    const {store, callCount} = countingStore();
    const app = buildApp({store});
    const directRequests = [
      {method: 'GET' as const, url: '/learners'},
      {method: 'POST' as const, url: '/learners', payload: learnerPayload},
      {method: 'GET' as const, url: '/learners/lrn_domain_auth'},
      {method: 'POST' as const, url: '/learners/lrn_domain_auth/photo', payload: {photo_base64: jpegBase64}},
      {method: 'GET' as const, url: '/registrations'},
      {method: 'POST' as const, url: '/registrations', payload: {}},
      {method: 'GET' as const, url: '/registrations/reg_domain_auth'},
      {method: 'PATCH' as const, url: '/registrations/reg_domain_auth/status', payload: {to_status: 'submitted'}},
      {method: 'GET' as const, url: '/archives'},
      {method: 'POST' as const, url: '/archives', payload: {}},
      {method: 'POST' as const, url: '/official-sync/consolidate', payload: {official_registrations: []}},
      {method: 'GET' as const, url: '/value-added/upgrade-radar'},
      {method: 'POST' as const, url: '/value-added/upgrade-radar', payload: {}},
      {method: 'POST' as const, url: '/value-added/id-photo-polish', payload: {
        learner_id: 'lrn_domain_auth', photo_base64: jpegBase64,
      }},
    ];
    const rpcActions = [
      'learnerList', 'learnerGet', 'learnerUpsert', 'enrollmentCreateOrUpdate',
      'registrationCreate', 'registrationList', 'teacherRosterList', 'registrationGet',
      'teacherRegistrationGetDetail', 'registrationSubmit', 'teacherRequestChanges',
      'teacherConfirm', 'teacherLock', 'teacherUnlock',
    ];

    try {
      for (const headers of [{}, {authorization: `Bearer ${teacherToken()}`}]) {
        for (const request of directRequests) {
          const response = await app.inject({...request, headers});
          assert.equal(response.statusCode, 401, `${request.url}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
        for (const action of rpcActions) {
          const response = await app.inject({method: 'POST', url: `/rpc/${action}`, headers, payload: {}});
          assert.equal(response.statusCode, 401, `${action}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(callCount(), 0);
    } finally {
      await app.close();
    }
  });

  it('preserves verified-admin direct workflows and no-store responses', async () => {
    const app = buildApp();
    const responses = [];
    try {
      const learner = await app.inject({method: 'POST', url: '/learners',
        headers: {'x-mea-session': familyToken()}, payload: learnerPayload});
      assert.equal(learner.statusCode, 201, learner.body);
      const learnerId = learner.json().id;
      responses.push(learner);
      for (const request of [
        {method: 'GET' as const, url: '/learners'},
        {method: 'GET' as const, url: `/learners/${learnerId}`},
        {method: 'POST' as const, url: `/learners/${learnerId}/photo`, payload: {photo_base64: jpegBase64}},
      ]) {
        const response = await app.inject({...request,
          headers: {cookie: familySessionCookie(familyToken()).split(';')[0]}});
        assert.equal(response.statusCode, 200, `${request.url}: ${response.body}`);
        responses.push(response);
      }
      const registration = await app.inject({method: 'POST', url: '/registrations',
        headers: {authorization: `Bearer ${familyToken()}`}, payload: {
          learner_id: learnerId, cycle_id: '2025-summer', subject_id: 'piano', level: 3,
        }});
      assert.equal(registration.statusCode, 201, registration.body);
      const registrationId = registration.json().id;
      responses.push(registration);
      for (const request of [
        {method: 'GET' as const, url: '/registrations'},
        {method: 'GET' as const, url: `/registrations/${registrationId}`},
        {method: 'PATCH' as const, url: `/registrations/${registrationId}/status`, payload: {to_status: 'submitted'}},
      ]) {
        const response = await app.inject({...request, headers: {'x-mea-session': familyToken()}});
        assert.equal(response.statusCode, 200, `${request.url}: ${response.body}`);
        responses.push(response);
      }
      const archive = await app.inject({method: 'POST', url: '/archives',
        headers: {authorization: `Bearer ${familyToken()}`}, payload: {
          learner_id: learnerId, cycle_id: '2024-summer', subject_id: 'piano', level: 2,
        }});
      assert.equal(archive.statusCode, 201, archive.body);
      responses.push(archive);
      for (const request of [
        {method: 'GET' as const, url: '/archives'},
        {method: 'GET' as const, url: '/value-added/upgrade-radar'},
        {method: 'POST' as const, url: '/value-added/upgrade-radar', payload: {}},
        {method: 'POST' as const, url: '/value-added/id-photo-polish', payload: {
          learner_id: learnerId, photo_base64: jpegBase64,
        }},
        {method: 'POST' as const, url: '/official-sync/consolidate', payload: {official_registrations: []}},
      ]) {
        const response = await app.inject({...request, headers: {'x-mea-session': familyToken()}});
        assert.equal(response.statusCode, 200, `${request.url}: ${response.body}`);
        responses.push(response);
      }
      for (const response of responses) assert.equal(response.headers['cache-control'], 'no-store');
    } finally {
      await app.close();
    }
  });

  it('preserves the verified-admin RPC learner and registration workflow', async () => {
    const app = buildApp();
    const headers = {'x-mea-session': familyToken()};
    const call = (action: string, payload: Record<string, unknown>) =>
      app.inject({method: 'POST', url: `/rpc/${action}`, headers, payload});
    const responses = [];
    try {
      const learner = await call('learnerUpsert', learnerPayload);
      assert.equal(learner.statusCode, 200, learner.body);
      const learnerId = learner.json().data._id;
      responses.push(learner);
      for (const [action, payload] of [
        ['learnerList', {}], ['learnerGet', {learner_id: learnerId}],
        ['enrollmentCreateOrUpdate', {learner_id: learnerId}],
      ]) {
        const response = await call(String(action), payload as Record<string, unknown>);
        assert.equal(response.statusCode, 200, `${action}: ${response.body}`);
        assert.equal(response.json().success, true);
        responses.push(response);
      }
      const registration = await call('registrationCreate', {
        learner_id: learnerId, cycle_id: '2025-summer', subject_id: 'piano', level: 3,
      });
      assert.equal(registration.statusCode, 200, registration.body);
      const registrationId = registration.json().data._id;
      responses.push(registration);
      for (const [action, payload] of [
        ['registrationList', {}], ['teacherRosterList', {}],
        ['registrationGet', {reg_id: registrationId}],
        ['teacherRegistrationGetDetail', {reg_id: registrationId}],
        ['registrationSubmit', {reg_id: registrationId}],
        ['teacherRequestChanges', {reg_id: registrationId, teacher_notes: '合成修改'}],
        ['registrationSubmit', {reg_id: registrationId}],
        ['teacherConfirm', {reg_id: registrationId}],
        ['teacherLock', {reg_id: registrationId}],
        ['teacherUnlock', {reg_id: registrationId, reason: '合成解锁'}],
      ]) {
        const response = await call(String(action), payload as Record<string, unknown>);
        assert.equal(response.statusCode, 200, `${action}: ${response.body}`);
        assert.equal(response.json().success, true);
        responses.push(response);
      }
      for (const response of responses) assert.equal(response.headers['cache-control'], 'no-store');
    } finally {
      await app.close();
    }
  });

  it('keeps generic photo processing public without exposing stored learner data', async () => {
    const app = buildApp();
    try {
      const generic = await app.inject({method: 'POST', url: '/value-added/id-photo-polish',
        payload: {name_cn: '合成公开用户', id_number_or_last4: '1234', photo_base64: jpegBase64}});
      assert.equal(generic.statusCode, 200, generic.body);
      const linked = await app.inject({method: 'POST', url: '/value-added/id-photo-polish',
        payload: {learner_id: 'lrn_domain_auth', photo_base64: jpegBase64}});
      assert.equal(linked.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
