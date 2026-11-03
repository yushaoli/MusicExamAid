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
  // Export PII must stay protected even when legacy development guards fail open.
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-export-auth-key-with-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
  delete process.env.WECOM_RELAY_TOKEN;
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const invite68 = 't_inv_68_' + 'a'.repeat(32);
const teacherToken = () => buildSignedTeacherToken(68, invite68);
const familyToken = () => buildSignedFamilyToken();

function lockedRegistration(store: DomainRepository) {
  const learner = store.createLearner({
    id: 'lrn_export_auth',
    name_cn: '合成导出学员',
    gender: '女',
    dob: '2016-01-02',
    id_type: '身份证',
    id_number: '110101201601021234',
    guardian_phone: '13800138000',
  });
  store.setLearnerPhoto(learner.id, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const registration = store.createRegistration({
    id: 'reg_export_auth',
    learner_id: learner.id,
    cycle_id: '2025-summer',
    subject_id: 'piano',
    level: 3,
  });
  store.transitionRegistration({id: registration.id, to_status: 'submitted'});
  store.transitionRegistration({id: registration.id, to_status: 'locked'});
  return registration;
}

describe('export authorization', () => {
  it('denies anonymous and teacher credentials before reading or creating export data', async () => {
    const store = new DomainRepository();
    let storageReads = 0;
    const listRegistrations = store.listRegistrations.bind(store);
    store.listRegistrations = () => {
      storageReads += 1;
      return listRegistrations();
    };
    const getExportBatch = store.getExportBatch.bind(store);
    store.getExportBatch = id => {
      storageReads += 1;
      return getExportBatch(id);
    };
    const app = buildApp({store});

    try {
      for (const headers of [{}, {authorization: `Bearer ${teacherToken()}`},
        {'x-mea-teacher-session': teacherToken()}]) {
        const requests = [
          {method: 'POST' as const, url: '/exports/dedup-preflight', payload: {cycle_id: '2025-summer'}},
          {method: 'POST' as const, url: '/exports', payload: {
            cycle_id: '2025-summer', registration_ids: ['reg_export_auth'],
          }},
          {method: 'GET' as const, url: '/exports/job_export_auth/csv'},
          {method: 'GET' as const, url: '/exports/job_export_auth/bundle.zip'},
          {method: 'POST' as const, url: '/rpc/superBatchExportOnce', payload: {cycle_id: '2025-summer'}},
        ];
        for (const request of requests) {
          const response = await app.inject({...request, headers});
          assert.equal(response.statusCode, 401, `${request.url}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(storageReads, 0);
    } finally {
      await app.close();
    }
  });

  it('allows verified family admins and marks export responses no-store', async () => {
    const store = new DomainRepository();
    const registration = lockedRegistration(store);
    const app = buildApp({store});

    try {
      const preflight = await app.inject({
        method: 'POST', url: '/exports/dedup-preflight',
        headers: {'x-mea-session': familyToken()},
        payload: {cycle_id: '2025-summer', registration_ids: [registration.id]},
      });
      assert.equal(preflight.statusCode, 200, preflight.body);
      assert.equal(preflight.json().included_ids[0], registration.id);
      assert.equal(preflight.headers['cache-control'], 'no-store');

      const created = await app.inject({
        method: 'POST', url: '/exports', headers: {authorization: `Bearer ${familyToken()}`},
        payload: {cycle_id: '2025-summer', registration_ids: [registration.id]},
      });
      assert.equal(created.statusCode, 202, created.body);
      assert.equal(created.json().preview_rows[0]['证件号码'], '110101201601021234');
      assert.equal(created.headers['cache-control'], 'no-store');

      const csv = await app.inject({
        method: 'GET', url: created.json().download_csv_url,
        headers: {cookie: familySessionCookie(familyToken()).split(';')[0]},
      });
      assert.equal(csv.statusCode, 200, csv.body);
      assert.match(csv.body, /合成导出学员/);
      assert.equal(csv.headers['cache-control'], 'no-store');

      const zip = await app.inject({
        method: 'GET', url: created.json().download_zip_url,
        headers: {'x-mea-session': familyToken()},
      });
      assert.equal(zip.statusCode, 200, zip.body);
      assert.equal(zip.rawPayload.subarray(0, 2).toString(), 'PK');
      assert.equal(zip.headers['cache-control'], 'no-store');

      const rpc = await app.inject({
        method: 'POST', url: '/rpc/superBatchExportOnce',
        headers: {authorization: `Bearer ${familyToken()}`}, payload: {cycle_id: '2025-summer'},
      });
      assert.equal(rpc.statusCode, 200, rpc.body);
      assert.equal(rpc.json().success, true);
      assert.equal(rpc.json().data.record_count, 1);
      assert.equal(rpc.headers['cache-control'], 'no-store');
    } finally {
      await app.close();
    }
  });

  it('keeps public dictionary RPC actions available without widening export access', async () => {
    const app = buildApp();
    try {
      const dictionary = await app.inject({method: 'POST', url: '/rpc/getDictSubjects', payload: {}});
      assert.equal(dictionary.statusCode, 200);
      assert.equal(dictionary.json().success, true);
      const exportResponse = await app.inject({
        method: 'POST', url: '/rpc/superBatchExportOnce', payload: {cycle_id: '2025-summer'},
      });
      assert.equal(exportResponse.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
