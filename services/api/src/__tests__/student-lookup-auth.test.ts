import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { buildApp } from '../app';
import type { OfficialSyncOptions } from '../routes/official-sync';
import { buildSignedFamilyToken, familySessionCookie, verifySignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken, isStrongTeacherInvite, teacherSessionCookie,
  verifySignedTeacherToken } from '../auth/teacher-session';

const keys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '1';
  process.env.SESSION_SIGNING_KEY = 'synthetic-history-test-key-with-at-least-32-bytes';
});
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

const invite68 = 't_inv_68_' + 'a'.repeat(32);
const invite69 = 't_inv_69_' + 'b'.repeat(32);
const lookup = '/official-sync/student-lookup';

function fixture() {
  const agents = [
    {agent_id: 68, invite_token: invite68, parent_referral_code: 'parent-68'},
    {agent_id: 69, invite_token: invite69, parent_referral_code: 'parent-69'},
    {agent_id: 999, invite_token: 'public-demo-invite', parent_referral_code: 'demo'},
  ];
  const students = [
    {student_id: 1, name_cn: '合成学员甲', agent_id: 68, all_exams: 3},
    {student_id: 2, name_cn: '合成学员乙', agent_id: 69, all_exams: 1},
  ];
  const exams = [
    {exam_id: 10, student_id: 1, agent_id: 68, season_code: 20254, level: 3, major_name: '钢琴'},
    {exam_id: 11, student_id: 1, agent_id: 68, season_code: 20244, level: 2, major_name: '钢琴'},
    // Same student's exam at another institution must not leak via nested history.
    {exam_id: 12, student_id: 1, agent_id: 69, season_code: 20265, level: 8, major_name: '钢琴'},
    {exam_id: 13, student_id: 2, agent_id: 69, season_code: 20265, level: 6, major_name: '钢琴'},
  ];
  const calls: Array<{sql: string; args: unknown[]}> = [];
  const pool = {query: async (sql: string, args: unknown[] = []) => {
    calls.push({sql, args});
    if (sql.includes('FROM kjzx_partner_agents')) {
      if (sql.includes('WHERE agent_id = $1::int')) {
        return {rows: agents.filter(a => a.agent_id === args[0])};
      }
      if (sql.includes('WHERE parent_referral_code')) {
        return {rows: agents.filter(a => a.parent_referral_code === args[0] || a.agent_id === args[1])};
      }
      return {rows: agents.filter(a => a.invite_token === args[0])};
    }
    if (sql.includes('FROM kjzx_historical_students')) {
      assert.match(sql, /AND \(\$2::int IS NULL OR s\.agent_id = \$2::int\)/);
      assert.match(sql, /CASE WHEN \$4::boolean THEN/);
      assert.match(sql, /owned\.student_id = s\.student_id AND owned\.agent_id = \$2::int/);
      assert.doesNotMatch(sql, /s\.all_exams DESC/);
      const rows = students.filter(s => args[1] === null || s.agent_id === args[1]).map(s => ({...s,
        all_exams: args[3] ? exams.filter(e => e.student_id === s.student_id && e.agent_id === args[1]).length : s.all_exams}));
      return {rows: rows.slice(0, Number(args[2]))};
    }
    if (sql.includes('FROM kjzx_historical_exams e')) {
      assert.match(sql, /AND \(\$2::int IS NULL OR e\.agent_id = \$2::int\)/);
      return {rows: exams.filter(e => (args[0] as number[]).includes(e.student_id) &&
        (args[1] === null || e.agent_id === args[1])).sort((a, b) => b.season_code - a.season_code)};
    }
    return {rows: []};
  }} as unknown as NonNullable<OfficialSyncOptions['postgresPool']>;
  return {pool, calls, agents};
}

function teacherHeaders() {
  return {'x-mea-teacher-session': buildSignedTeacherToken(68, invite68)};
}
function cookieValue(header: string | string[] | undefined) {
  return String(Array.isArray(header) ? header[0] : header).split(';')[0];
}

describe('historical student lookup authorization', () => {
  it('rejects forged/expired teacher claims and separates teacher from admin tokens', () => {
    const token = buildSignedTeacherToken(68, invite68);
    assert.equal(verifySignedTeacherToken(token)?.agentId, 68);
    assert.equal(verifySignedFamilyToken(token), false);
    assert.equal(verifySignedTeacherToken(buildSignedFamilyToken()), null);
    assert.equal(verifySignedTeacherToken(token.replace('teacher.v1.68.', 'teacher.v1.69.')), null);
    const parts = token.split('.');
    parts[4] = '0'.repeat(32);
    assert.equal(verifySignedTeacherToken(parts.join('.')), null);
    assert.equal(verifySignedTeacherToken('teacher.v1.68.9999999999.' + 'é'.repeat(64)), null);
    assert.equal(isStrongTeacherInvite(69, invite68), false);
    assert.throws(() => buildSignedTeacherToken(999, 'public-demo-invite'), /128-bit/);
    assert.throws(() => buildSignedTeacherToken(68, invite68, 28_801), /8 hours/);
    const realNow = Date.now;
    try {
      const start = realNow();
      Date.now = () => start;
      const short = buildSignedTeacherToken(68, invite68, 1);
      Date.now = () => start + 1000;
      assert.equal(verifySignedTeacherToken(short), null);
    } finally { Date.now = realNow; }
  });

  it('rejects anonymous identity hints and malformed cookies before opening storage', async () => {
    // New PII protection also applies in local development with the old flag off.
    process.env.ENFORCE_SERVER_AUTH = '0';
    const app = buildApp();
    try {
      for (const url of [lookup, lookup + '?agent_id=68', lookup + '?role=admin&ref=68',
        lookup + '?invite_token=' + invite68 + '&wx_openid=client-supplied']) {
        const response = await app.inject({method: 'GET', url,
          headers: {cookie: 'mea_teacher_session=%broken'}});
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
    } finally { await app.close(); }
  });

  it('exchanges a valid invite for an HttpOnly session and scopes nested exam data and counts', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      const login = await app.inject({method: 'GET', url: '/official-sync/resolve-session?invite_token=' + invite68});
      assert.equal(login.statusCode, 200);
      assert.equal(login.json().history_access, true);
      assert.equal(login.headers['cache-control'], 'no-store');
      assert.match(String(login.headers['set-cookie']), /Max-Age=28800; HttpOnly; SameSite=Lax/);
      assert.doesNotMatch(login.body, /teacher\.v1\./);
      const res = await app.inject({method: 'GET', url: lookup, headers: {cookie: cookieValue(login.headers['set-cookie'])}});
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().count, 1);
      const student = res.json().items[0];
      assert.equal(student.student_id, 1);
      assert.equal(student.all_exams, 2);
      assert.deepEqual(student.exams.map((e: {exam_id: number}) => e.exam_id), [10, 11]);
      assert.equal(student.latest_exam.exam_id, 10);
      assert.equal(student.recommended_upgrade.recommended_level, 4);
      assert.equal(res.headers['cache-control'], 'no-store');
    } finally { await app.close(); }
  });

  it('rejects cross-teacher filters and validates query parameters before reading student rows', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      const cross = await app.inject({method: 'GET', url: lookup + '?agent_id=69&role=admin', headers: teacherHeaders()});
      assert.equal(cross.statusCode, 403);
      for (const query of ['agent_id=NaN', 'agent_id=0', 'agent_id=2147483648', 'limit=Infinity',
        'limit=0', 'limit=1.5', 'q=a&q=b', 'q=' + 'x'.repeat(201)]) {
        const res = await app.inject({method: 'GET', url: lookup + '?' + query, headers: teacherHeaders()});
        assert.equal(res.statusCode, 400, query + ': ' + res.body);
      }
      assert.equal(f.calls.filter(c => c.sql.includes('FROM kjzx_historical_students')).length, 0);
      const own = await app.inject({method: 'GET', url: lookup + '?agent_id=68&limit=900', headers: teacherHeaders()});
      assert.equal(own.statusCode, 200);
      assert.deepEqual(f.calls.find(c => c.sql.includes('FROM kjzx_historical_students'))?.args, ['', 68, 50, true]);
    } finally { await app.close(); }
  });

  it('supports teacher header/bearer/cookie credentials without granting admin permissions', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const token = buildSignedTeacherToken(68, invite68);
    try {
      for (const headers of [{ 'x-mea-teacher-session': token }, {authorization: 'Bearer ' + token},
        {cookie: 'mea_teacher_session=' + encodeURIComponent(token)}]) {
        const own = await app.inject({method: 'GET', url: lookup, headers});
        assert.equal(own.statusCode, 200);
        assert.equal(own.json().items[0].agent_id, 68);
        const admin = await app.inject({method: 'GET', url: '/official-sync/partner-agents', headers});
        assert.equal(admin.statusCode, 401);
      }
      const write = await app.inject({method: 'POST', url: '/official-sync/video-chushen-apply',
        headers: teacherHeaders(), payload: {dry_run: true, items: [{exam_id: 10, action: 'PASS'}]}});
      assert.equal(write.statusCode, 401);
    } finally { await app.close(); }
  });

  it('revokes a teacher session immediately after invite rotation or agent removal', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const headers = teacherHeaders();
    try {
      f.agents[0].invite_token = 't_inv_68_' + 'c'.repeat(32);
      const revoked = await app.inject({method: 'GET', url: lookup, headers});
      assert.equal(revoked.statusCode, 401);
      f.agents.shift();
      const removed = await app.inject({method: 'GET', url: lookup, headers});
      assert.equal(removed.statusCode, 401);
      assert.equal(f.calls.filter(c => c.sql.includes('FROM kjzx_historical_students')).length, 0);
    } finally { await app.close(); }
  });

  it('keeps parent referrals and weak public demo invites from authorizing student lookup', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    try {
      for (const query of ['ref=parent-68', 'invite_token=public-demo-invite', 'invite_token=invalid']) {
        const login = await app.inject({method: 'GET', url: '/official-sync/resolve-session?' + query,
          headers: {cookie: cookieValue(teacherSessionCookie(buildSignedTeacherToken(68, invite68)))}});
        assert.match(String(login.headers['set-cookie']), /mea_teacher_session=; Path=\/; Max-Age=0;/);
        if (query.includes('public-demo')) assert.equal(login.json().history_access, false);
        const data = await app.inject({method: 'GET', url: lookup, headers: {cookie: cookieValue(login.headers['set-cookie'])}});
        assert.equal(data.statusCode, 401);
      }
    } finally { await app.close(); }
  });

  it('preserves verified admin browsing and full history when filtering the current teacher', async () => {
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const token = buildSignedFamilyToken();
    try {
      for (const headers of [{'x-mea-session': token}, {authorization: 'Bearer ' + token},
        {cookie: cookieValue(familySessionCookie(token))}]) {
        const all = await app.inject({method: 'GET', url: lookup, headers});
        assert.equal(all.statusCode, 200, all.body);
        assert.equal(all.json().count, 2);
        const filtered = await app.inject({method: 'GET', url: lookup + '?agent_id=68', headers});
        assert.equal(filtered.json().items[0].all_exams, 3);
        assert.deepEqual(filtered.json().items[0].exams.map((e: {exam_id: number}) => e.exam_id), [12, 10, 11]);
      }
      assert.equal(f.calls.filter(c => c.sql.includes('FROM kjzx_partner_agents')).length, 0);
    } finally { await app.close(); }
  });

  it('marks teacher cookies secure in production and rejects expired credentials before querying', async () => {
    process.env.NODE_ENV = 'production';
    assert.match(teacherSessionCookie(buildSignedTeacherToken(68, invite68)), /HttpOnly; SameSite=Lax; Secure$/);
    assert.match(teacherSessionCookie(null), /Max-Age=0; HttpOnly; SameSite=Lax; Secure$/);
    process.env.NODE_ENV = 'test';
    const f = fixture();
    const app = buildApp({officialSync: {postgresPool: f.pool}});
    const realNow = Date.now;
    try {
      const start = realNow();
      Date.now = () => start;
      const token = buildSignedTeacherToken(68, invite68, 1);
      Date.now = () => start + 1000;
      const res = await app.inject({method: 'GET', url: lookup, headers: {'x-mea-teacher-session': token}});
      assert.equal(res.statusCode, 401);
      assert.equal(f.calls.length, 0);
    } finally { Date.now = realNow; await app.close(); }
  });

  it('shows an access error in the browser instead of treating unauthorized results as an empty archive', async () => {
    const app = buildApp();
    try {
      const html = (await app.inject({method: 'GET', url: '/app'})).body;
      const start = html.indexOf('async function searchHistoricalStudent(mode)');
      const end = html.indexOf('async function autofillFromHistorical', start);
      assert.ok(end > start);
      const box = {innerHTML: '', textContent: ''};
      const context = vm.createContext({currentSession: {locked_agent: null},
        document: {getElementById: (id: string) => id === 'quick-search-input' ? {value: '合成学员'} : box},
        fetch: async () => ({ok: false, status: 401, json: () => assert.fail('Unauthorized response rendered as student data')})});
      await vm.runInContext(html.slice(start, end) + '\nsearchHistoricalStudent("parent")', context);
      assert.match(box.textContent, /没有历史档案查询权限/);
    } finally { await app.close(); }
  });
});
