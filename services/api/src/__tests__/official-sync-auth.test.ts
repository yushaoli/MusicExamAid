import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildApp } from '../app';
import { buildSignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY', 'ENABLE_LIVE_STORAGE'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-official-sync-auth-key-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const teacherHeaders = () => ({authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'c'.repeat(32))}`});

const strictRequests = [
  {method: 'POST' as const, url: '/official-sync/consolidate', payload: {}},
  {method: 'POST' as const, url: '/official-sync/pull-remote', payload: {}},
  {method: 'GET' as const, url: '/official-sync/archive-stats'},
  {method: 'GET' as const, url: '/official-sync/archive-upgrade-radar'},
  {method: 'GET' as const, url: '/official-sync/partner-agents'},
  {method: 'GET' as const, url: '/official-sync/studio-growth-intelligence'},
  {method: 'GET' as const, url: '/official-sync/media-proxy'},
  {method: 'GET' as const, url: '/official-sync/media-cache-stats'},
  {method: 'POST' as const, url: '/official-sync/media-prebuffer', payload: {}},
  {method: 'GET' as const, url: '/official-sync/teacher-fee-and-filing-report'},
  {method: 'POST' as const, url: '/official-sync/stage-cert-or-photo', payload: {}},
  {method: 'POST' as const, url: '/official-sync/execute-cert-or-photo', payload: {}},
  {method: 'GET' as const, url: '/official-sync/mom-upload-log'},
  {method: 'GET' as const, url: '/official-sync/look-score-captcha'},
  {method: 'POST' as const, url: '/official-sync/look-score-query', payload: {}},
  {method: 'GET' as const, url: '/official-sync/yushen-model-status'},
  {method: 'POST' as const, url: '/official-sync/video-chushen-check', payload: {}},
  {method: 'POST' as const, url: '/official-sync/video-chushen-apply', payload: {}},
  {method: 'POST' as const, url: '/official-sync/video-ai-5d-review', payload: {}},
];

function fixturePool() {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      return {rows: []};
    },
  } as unknown as Pick<Pool, 'query'>;
  return {pool, queries};
}

describe('strict official-sync authorization', () => {
  it('denies anonymous and teacher credentials before every administrative route opens SQL', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      for (const headers of [{}, teacherHeaders()]) {
        for (const request of strictRequests) {
          const response = await app.inject({...request, headers});
          assert.equal(response.statusCode, 401, `${request.url}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(f.queries.length, 0);
    } finally {
      await app.close();
    }
  });

  it('preserves verified-admin access to previously unguarded and legacy-bypass routes', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const requests = [
      {method: 'POST' as const, url: '/official-sync/pull-remote', payload: {}, statuses: [400]},
      {method: 'GET' as const, url: '/official-sync/archive-stats', statuses: [200]},
      {method: 'GET' as const, url: '/official-sync/archive-upgrade-radar', statuses: [200]},
      {method: 'GET' as const, url: '/official-sync/teacher-fee-and-filing-report', statuses: [200]},
      {method: 'GET' as const, url: '/official-sync/mom-upload-log', statuses: [200]},
      {method: 'POST' as const, url: '/official-sync/look-score-query', payload: {}, statuses: [400]},
      {method: 'GET' as const, url: '/official-sync/yushen-model-status', statuses: [200, 503]},
    ];
    try {
      for (const request of requests) {
        const response = await app.inject({...request, headers: familyHeaders()});
        assert.ok(request.statuses.includes(response.statusCode), `${request.url}: ${response.body}`);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
    } finally {
      await app.close();
    }
  });

  it('keeps only explicit QR and invite authentication entry points self-authorizing', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      const status = await app.inject({method: 'GET', url: '/official-sync/session-status'});
      assert.equal(status.statusCode, 200);
      const qr = await app.inject({method: 'POST', url: '/official-sync/qr-session', payload: {
        mock_php_sess_id: 'synthetic-php-session',
        mock_html: '<img src="data:image/png;base64,c3ludGhldGlj"><script>get_wxauth_status("synthetic-token", function() {});</script>',
      }});
      assert.equal(qr.statusCode, 200, qr.body);
      const poll = await app.inject({method: 'POST', url: '/official-sync/wxauth-poll', payload: {}});
      assert.equal(poll.statusCode, 400);
      const family = await app.inject({method: 'POST', url: '/official-sync/family-auth', payload: {}});
      assert.equal(family.statusCode, 401);
      const invite = await app.inject({method: 'GET', url: '/official-sync/resolve-session?invite_token=invalid'});
      assert.equal(invite.statusCode, 401);
      const lookup = await app.inject({method: 'GET', url: '/official-sync/student-lookup'});
      assert.equal(lookup.statusCode, 401);
      const bind = await app.inject({method: 'POST', url: '/official-sync/bind-teacher-wechat', payload: {}});
      assert.equal(bind.statusCode, 400);
      assert.equal(f.queries.length, 1);
      assert.match(f.queries[0], /invite_token/);
    } finally {
      await app.close();
    }
  });
});
