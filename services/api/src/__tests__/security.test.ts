import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as vm from 'node:vm';
import { buildApp } from '../app';
import type { OfficialSyncOptions } from '../routes/official-sync';
import { buildSignedFamilyToken, verifySignedFamilyToken, familySessionCookie } from '../auth/family-session';
import { getPostgresPool } from '../store/postgres';
import { MinioStorageClient } from '../store/minio';

const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY', 'ENCRYPTION_KEY',
  'SNAPSHOT_AES_KEY_HEX', 'ENABLE_LIVE_STORAGE', 'LIVE_E2E', 'PORTAL_WRITE_ENABLED'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '1';
  process.env.SESSION_SIGNING_KEY = 'synthetic-review-session-key-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
  process.env.PORTAL_WRITE_ENABLED = '0';
  delete process.env.LIVE_E2E;
});
afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fixturePool() {
  const agents = [
    {agent_id: 999, invite_token: 'synthetic-invite-999', wx_nickname: 'teacher 999'},
    {agent_id: 68, invite_token: 'synthetic-invite-68', wx_nickname: 'teacher 68'},
  ];
  const calls: Array<{sql: string; args: unknown[]}> = [];
  const pool = {query: async (sql: string, args: unknown[] = []) => {
    calls.push({sql, args});
    if (sql.includes('UPDATE kjzx_partner_agents')) {
      // The SQL must constrain both inputs. A disjunction recreates the reported bypass.
      if (args[0]) assert.match(sql, /invite_token = \$1::text AND/);
      const rows = agents.filter(a => args[0]
        ? a.invite_token === args[0] && (args[1] === null || a.agent_id === args[1])
        : a.agent_id === args[1]);
      for (const a of rows) a.wx_nickname = String(args[3] || '');
      return {rows};
    }
    if (sql.includes('FROM kjzx_partner_agents') && args.length) {
      if (args.length === 2) assert.match(sql, /\$1::text IS NULL AND \$2::text IS NOT NULL/);
      return {rows: agents.filter(a => a.invite_token === args[0])};
    }
    return {rows: []};
  }} as unknown as NonNullable<OfficialSyncOptions['postgresPool']>;
  return {pool, calls, agents};
}

describe('server auth and storage boundaries', () => {
  it('rejects missing and weak signing keys, and disabled auth, at production startup', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SIGNING_KEY;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SNAPSHOT_AES_KEY_HEX;
    assert.throws(() => buildApp(), /signing key/);
    process.env.SESSION_SIGNING_KEY = 'CHANGE_ME_32_BYTES_RANDOM';
    assert.throws(() => buildApp(), /signing key/);
    process.env.SESSION_SIGNING_KEY = 'a'.repeat(64);
    process.env.ENFORCE_SERVER_AUTH = '0';
    assert.throws(() => buildApp(), /ENFORCE_SERVER_AUTH/);
  });

  it('rejects legacy, expired, tampered, and malformed tokens', () => {
    const valid = buildSignedFamilyToken(3600);
    assert.equal(verifySignedFamilyToken(valid), true);
    assert.equal(verifySignedFamilyToken(valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a')), false);
    const legacy = crypto.createHmac('sha256', process.env.SESSION_SIGNING_KEY!)
      .update('authorized_family_wechat_002120_3person_only').digest('hex').slice(0, 32);
    assert.equal(verifySignedFamilyToken(legacy), false);
    assert.equal(verifySignedFamilyToken('v1.9999999999.' + 'é'.repeat(32)), false);
    const realNow = Date.now;
    try {
      const start = realNow();
      Date.now = () => start;
      const token = buildSignedFamilyToken(1);
      Date.now = () => start + 1000;
      assert.equal(verifySignedFamilyToken(token), false);
    } finally { Date.now = realNow; }
    process.env.NODE_ENV = 'production';
    assert.match(familySessionCookie(valid), /HttpOnly; SameSite=Lax; Secure$/);
  });

  it('rejects anonymous writes and token listings before querying a database', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      for (const url of ['/official-sync/partner-agents', '/official-sync/studio-growth-intelligence',
        '/official-sync/resolve-session?wx_openid=unverified-client-input']) {
        assert.equal((await app.inject({method: 'GET', url})).statusCode, 401);
      }
      for (const url of ['/official-sync/pull-remote', '/official-sync/execute-cert-or-photo',
        '/official-sync/video-chushen-apply', '/official-sync/video-chushen-check']) {
        const res = await app.inject({method: 'POST', url, payload: {auto_persist: true},
          headers: {cookie: 'mea_family_session=%broken'}});
        assert.equal(res.statusCode, 401, url);
      }
      const bind = await app.inject({method: 'POST', url: '/official-sync/bind-teacher-wechat',
        payload: {agent_id: 68}});
      assert.equal(bind.statusCode, 401);
      assert.equal(f.calls.length, 0);
    } finally { await app.close(); }
  });

  it('confines invite-token bind and unbind to that teacher, while allowing an admin ID lookup', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const url = '/official-sync/bind-teacher-wechat';
    try {
      for (const unbind of [false, true]) {
        for (const invite_token of ['invalid-nonempty-token', 'synthetic-invite-999']) {
          const res = await app.inject({method: 'POST', url, payload: {invite_token, agent_id: 68, unbind}});
          assert.equal(res.statusCode, 404, res.body);
          assert.equal(f.agents[1].wx_nickname, 'teacher 68');
        }
      }
      const teacher = await app.inject({method: 'POST', url, payload: {
        invite_token: 'synthetic-invite-999', agent_id: 999,
        wx_nickname: '<img src=x onerror=alert(1)>测试老师',
      }});
      assert.equal(teacher.statusCode, 200);
      assert.equal(teacher.json().agent.agent_id, 999);
      assert.doesNotMatch(teacher.json().agent.wx_nickname, /[<>]/);
      const admin = await app.inject({method: 'POST', url,
        headers: {authorization: `Bearer ${buildSignedFamilyToken()}`}, payload: {agent_id: 68}});
      assert.equal(admin.statusCode, 200);
      const unbound = await app.inject({method: 'POST', url,
        payload: {invite_token: 'synthetic-invite-999', unbind: true}});
      assert.equal(unbound.statusCode, 200);
    } finally { await app.close(); }
  });

  it('supports header and cookie sessions and keeps dry-run apply free of SQL', async () => {
    const f = fixturePool();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      for (const headers of [{ 'x-mea-session': buildSignedFamilyToken() },
        {cookie: `mea_family_session=${buildSignedFamilyToken()}`}]) {
        const res = await app.inject({method: 'POST', url: '/official-sync/video-chushen-apply', headers,
          payload: {dry_run: true, items: [{exam_id: 123, action: 'PASS'}]}});
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().official_synced_count, 0);
      }
      assert.equal(f.calls.length, 0);
      const badInvite = await app.inject({method: 'GET', url: '/official-sync/resolve-session?invite_token=invalid'});
      assert.equal(badInvite.statusCode, 401);
      const mixedIdentity = await app.inject({method: 'GET',
        url: '/official-sync/resolve-session?invite_token=invalid&wx_openid=known-openid'});
      assert.equal(mixedIdentity.statusCode, 401);
    } finally { await app.close(); }
  });

  it('blocks default tests from opening live PostgreSQL or writing MinIO', async () => {
    assert.throws(() => getPostgresPool(), /disabled in tests/);
    await assert.rejects(new MinioStorageClient().ensureBucket(), /disabled in tests/);
  });
});

describe('browser security regressions', () => {
  it('attaches session headers only to the same origin and preserves Request headers', async () => {
    const app = buildApp();
    try {
      const html = (await app.inject({method: 'GET', url: '/app'})).body;
      const wrapper = html.slice(html.indexOf('(function wrapFetchWithSession()'), html.indexOf('    const LEVEL_FEES'));
      const requests: Array<{input: unknown; init?: RequestInit}> = [];
      const window = {fetch: async (input: unknown, init?: RequestInit) => { requests.push({input, init}); }};
      const context = vm.createContext({window, URL, Headers, Request,
        location: {href: 'https://mea.example/app', origin: 'https://mea.example'},
        localStorage: {getItem: () => 'synthetic-session'}});
      vm.runInContext(wrapper, context);
      await window.fetch('//external.example/path');
      assert.equal(requests[0].init, undefined);
      await window.fetch(new Request('https://mea.example/health', {headers: {'X-Custom': 'preserved'}}));
      const headers = new Headers(requests[1].init!.headers);
      assert.equal(headers.get('X-Mea-Session'), 'synthetic-session');
      assert.equal(headers.get('X-Custom'), 'preserved');
    } finally { await app.close(); }
  });

  it('keeps hostile student names out of inline JavaScript and passes them as button data', async () => {
    const app = buildApp();
    try {
      const html = (await app.inject({method: 'GET', url: '/app'})).body;
      const escapeFn = html.slice(html.indexOf('function escapeHtml(val)'), html.indexOf('// Automatically attach signed family'));
      const renderFn = html.slice(html.indexOf('function momFilterChushenView(onlyFlagged)'), html.indexOf('async function momRunBatchChushen'));
      assert.doesNotMatch(renderFn, /onclick="playVideoLocally/);
      const hostileName = "'-alert(1)-'<img src=x onerror=alert(2)>";
      let click: (() => void) | undefined;
      let receivedTitle = '';
      const encodedTitle = encodeURIComponent(hostileName + ' · 钢琴5级');
      const box = {innerHTML: '', querySelectorAll: () => [{
        dataset: {chushenAction: 'video', url: encodeURIComponent('https://example.invalid/video'),
          title: encodedTitle, studentId: '1', examId: '2'},
        addEventListener: (_: string, fn: () => void) => { click = fn; },
      }]};
      const context = vm.createContext({document: {getElementById: () => box}, encodeURIComponent,
        momLastChushenRes: {items: [{student_name: hostileName, major_name: '钢琴', level: 5,
          verdict: 'AUTO_PASS', exam_id: 2, student_id: 1, first_video_url: 'https://example.invalid/video'}]},
        playVideoLocally: (_: string, title: string) => { receivedTitle = decodeURIComponent(title); },
        alert: () => assert.fail('Untrusted text executed as JavaScript')});
      vm.runInContext(escapeFn + '\n' + renderFn + '\nmomFilterChushenView(false)', context);
      assert.ok(click);
      click();
      assert.equal(receivedTitle, hostileName + ' · 钢琴5级');
      assert.ok(box.innerHTML.includes('&lt;img'));
      const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
      for (const script of scripts) new vm.Script(script[1]);
    } finally { await app.close(); }
  });

  it('includes the teacher invite token when the invited UI binds WeChat', async () => {
    const app = buildApp();
    try {
      const html = (await app.inject({method: 'GET', url: '/app'})).body;
      const fn = html.slice(html.indexOf('async function bindCurrentTeacherWeChat(unbind)'), html.indexOf('function copyParentReferralLink'));
      let payload: any;
      const context = vm.createContext({currentSession: {locked_agent: {agent_id: 68, invite_token: 'synthetic-invite-68'}},
        document: {getElementById: () => ({value: 'teacher'})},
        fetch: async (_: string, init: {body: string}) => { payload = JSON.parse(init.body); return {json: async () => ({})}; }});
      await vm.runInContext(fn + '\nbindCurrentTeacherWeChat(false)', context);
      assert.equal(payload.invite_token, 'synthetic-invite-68');
      assert.equal(payload.agent_id, 68);
    } finally { await app.close(); }
  });
});
