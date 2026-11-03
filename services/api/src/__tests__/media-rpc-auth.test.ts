import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import { buildSignedFamilyToken } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY', 'ENABLE_LIVE_STORAGE'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-media-rpc-auth-key-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const teacherHeaders = () => ({authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'b'.repeat(32))}`});

const unimplementedActions = [
  'authLogin', 'registrationUpdate', 'attachmentCommit', 'teacherSubmitToInstitution',
  'instBatchCreate', 'instBatchList', 'instBatchGet', 'instBatchAddItems',
  'instBatchRemoveItems', 'instBatchPreflight', 'instBatchSubmitToSuper',
  'superIncomingInstBatchesList', 'superBatchCreate', 'superBatchGet',
  'superBatchIngestInstitutionBatches', 'superBatchDedupRun',
  'superBatchResolveConflict', 'superBatchPreflight',
];

const mediaRequests = [
  {method: 'GET' as const, url: '/official-sync/media-proxy'},
  {method: 'GET' as const, url: '/official-sync/media-cache-stats'},
  {method: 'POST' as const, url: '/official-sync/media-prebuffer', payload: {}},
  {method: 'POST' as const, url: '/official-sync/stage-cert-or-photo', payload: {}},
  {method: 'POST' as const, url: '/official-sync/execute-cert-or-photo', payload: {}},
  {method: 'POST' as const, url: '/official-sync/video-chushen-check', payload: {probe_media: false}},
  {method: 'POST' as const, url: '/official-sync/video-chushen-apply', payload: {dry_run: true, items: []}},
  {method: 'POST' as const, url: '/official-sync/video-ai-5d-review', payload: {exam_id: 123}},
];

function fixture() {
  const queries: string[] = [];
  const postgresPool = {
    query: async (text: string) => {
      queries.push(text);
      return {rows: []};
    },
  } as unknown as Pick<Pool, 'query'>;
  let storeCalls = 0;
  const target = new DomainRepository();
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        storeCalls += 1;
        return Reflect.apply(value, object, args);
      };
    },
  });
  return {postgresPool, queries, store, storeCalls: () => storeCalls};
}

describe('media and remaining RPC authorization', () => {
  it('denies anonymous and teacher access before media SQL or RPC repository access', async () => {
    const f = fixture();
    const app = buildApp({store: f.store, officialSync: {postgresPool: f.postgresPool}});
    try {
      for (const headers of [{}, teacherHeaders()]) {
        for (const request of mediaRequests) {
          const response = await app.inject({...request, headers});
          assert.equal(response.statusCode, 401, `${request.url}: ${response.body}`);
          assert.equal(response.json().error, 'UNAUTHORIZED');
          assert.equal(response.headers['cache-control'], 'no-store');
        }
        for (const action of [...unimplementedActions, 'unknownFutureAction']) {
          const response = await app.inject({method: 'POST', url: `/rpc/${action}`, headers, payload: {}});
          assert.equal(response.statusCode, 401, `${action}: ${response.body}`);
          assert.equal(response.headers['cache-control'], 'no-store');
        }
      }
      assert.equal(f.queries.length, 0);
      assert.equal(f.storeCalls(), 0);
    } finally {
      await app.close();
    }
  });

  it('fails closed for placeholder and unknown RPC actions instead of inventing roles or success', async () => {
    const f = fixture();
    const app = buildApp({store: f.store, officialSync: {postgresPool: f.postgresPool}});
    try {
      for (const action of unimplementedActions) {
        const response = await app.inject({method: 'POST', url: `/rpc/${action}`,
          headers: familyHeaders(), payload: {}});
        assert.equal(response.statusCode, 501, `${action}: ${response.body}`);
        assert.equal(response.json().success, false);
        assert.equal(response.json().code, 'RPC_NOT_IMPLEMENTED');
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      const unknown = await app.inject({method: 'POST', url: '/rpc/unknownFutureAction',
        headers: familyHeaders(), payload: {}});
      assert.equal(unknown.statusCode, 404);
      assert.equal(unknown.json().code, 'RPC_NOT_FOUND');
      assert.equal(f.queries.length, 0);
      assert.equal(f.storeCalls(), 0);
    } finally {
      await app.close();
    }
  });

  it('keeps only static dictionary and institution RPCs public', async () => {
    const app = buildApp();
    try {
      for (const action of ['getDictSubjects', 'getDictCycles', 'institutionList']) {
        const response = await app.inject({method: 'POST', url: `/rpc/${action}`, payload: {}});
        assert.equal(response.statusCode, 200, `${action}: ${response.body}`);
        assert.equal(response.json().success, true);
        assert.ok(Array.isArray(response.json().data));
      }
    } finally {
      await app.close();
    }
  });

  it('allows verified admins to reach media handlers with no-store responses', async () => {
    const f = fixture();
    const app = buildApp({store: f.store, officialSync: {postgresPool: f.postgresPool}});
    const expectedStatuses = [400, 200, 200, 200, 400, 404, 400, 404];
    try {
      for (const [index, request] of mediaRequests.entries()) {
        const response = await app.inject({...request, headers: familyHeaders()});
        assert.equal(response.statusCode, expectedStatuses[index], `${request.url}: ${response.body}`);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
    } finally {
      await app.close();
    }
  });
});
