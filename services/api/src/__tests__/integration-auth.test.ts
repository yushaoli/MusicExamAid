import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeChatSignature } from '@musicexamaid/shared';
import { buildApp } from '../app';
import { buildSignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY',
  'WECOM_RELAY_TOKEN', 'WECHAT_MP_SECRET'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-integration-auth-key-at-least-32-bytes';
  delete process.env.WECOM_RELAY_TOKEN;
  delete process.env.WECHAT_MP_SECRET;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const teacherHeaders = () => ({authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'd'.repeat(32))}`});

const notificationRequests = [
  {url: '/notifications/wecom', payload: {msg: '合成通知'}},
  {url: '/notifications/wechat-mp', payload: {
    mp_openid: 'synthetic-openid', registration_id: 'reg_synthetic', to_status: 'submitted',
  }},
];

describe('integration authorization and webhook signatures', () => {
  it('denies anonymous and teacher notification dispatch before any outbound request', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('Unexpected outbound request');
    };
    const app = buildApp();
    try {
      for (const headers of [{}, teacherHeaders()]) {
        for (const request of notificationRequests) {
          const response = await app.inject({method: 'POST', ...request, headers});
          assert.equal(response.statusCode, 401, `${request.url}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(fetchCalls, 0);
    } finally {
      await app.close();
    }
  });

  it('preserves verified-admin notification previews with no-store responses', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('Unexpected outbound request');
    };
    const app = buildApp();
    try {
      for (const request of notificationRequests) {
        const response = await app.inject({method: 'POST', ...request, headers: familyHeaders()});
        assert.equal(response.statusCode, 200, `${request.url}: ${response.body}`);
        assert.equal(response.json().status, 'dry_run');
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(fetchCalls, 0);
    } finally {
      await app.close();
    }
  });

  it('rejects missing or invalid webhook POST signatures and accepts valid callbacks', async () => {
    const app = buildApp();
    const timestamp = '1760000000';
    const nonce = 'synthetic-nonce';
    try {
      for (const path of ['/webhooks/wechat-mp', '/webhooks/wecom']) {
        const missing = await app.inject({method: 'POST', url: path, payload: {}});
        assert.equal(missing.statusCode, 403, path);
        const invalid = await app.inject({method: 'POST',
          url: `${path}?signature=invalid&timestamp=${timestamp}&nonce=${nonce}`, payload: {}});
        assert.equal(invalid.statusCode, 403, path);
        const token = path.endsWith('wecom')
          ? process.env.WECOM_CALLBACK_TOKEN || process.env.WECHAT_MP_TOKEN || 'dev_wecom_token'
          : process.env.WECHAT_MP_TOKEN || 'dev_wechat_mp_token';
        const signature = computeWeChatSignature(token, timestamp, nonce);
        const signatureParam = path.endsWith('wecom') ? 'msg_signature' : 'signature';
        const valid = await app.inject({method: 'POST',
          url: `${path}?${signatureParam}=${signature}&timestamp=${timestamp}&nonce=${nonce}`, payload: {}});
        assert.equal(valid.statusCode, 200, `${path}: ${valid.body}`);
        assert.equal(valid.body, 'success');
      }
    } finally {
      await app.close();
    }
  });
});
