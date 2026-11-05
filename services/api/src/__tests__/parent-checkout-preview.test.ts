import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildApp } from '../app';
import { DomainRepository } from '../store/repository';
import type { ParentAccessOptions } from '../routes/parent-access';
import { buildSignedParentToken } from '../auth/parent-session';
import { buildSignedFamilyToken, signSessionPayload } from '../auth/family-session';
import { buildSignedTeacherToken } from '../auth/teacher-session';

const OPENID = 'synthetic_checkout_parent';
const envKeys = ['NODE_ENV', 'ENFORCE_SERVER_AUTH', 'SESSION_SIGNING_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.ENFORCE_SERVER_AUTH = '0';
  process.env.SESSION_SIGNING_KEY = 'synthetic-checkout-preview-key-at-least-32-bytes';
});
afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function fixture() {
  const target = new DomainRepository();
  for (const id of ['lrn_owned', 'lrn_other']) {
    target.createLearner({id, name_cn: '合成学员', gender: '女', dob: '2016-01-02',
      id_type: '身份证', id_number: '110101201601021234', guardian_phone: '13800138000'});
  }
  for (const [id, level] of [['owned', 3], ['default', 5], ['builtin', 8], ['other', 3]] as const) {
    target.createRegistration({id: `reg_${id}`, learner_id: id === 'other' ? 'lrn_other' : 'lrn_owned',
      teacher_id: id === 'owned' ? 'tch_synthetic' : 'tch_other', cycle_id: 'cycle_synthetic',
      subject_id: 'piano', level, repertoire: ['合成曲目']});
  }
  target.upsertTeacherGradeRateCard({teacher_id: 'tch_synthetic', level: 3,
    exam_fee_fen: 52700, concession_fen: 7000, note: '合成内部备注'});
  target.upsertTeacherGradeRateCard({teacher_id: 'DEFAULT', level: 5,
    exam_fee_fen: 53500, concession_fen: 8000, note: '合成默认内部备注'});
  const control = {revoked: false, unavailable: false};
  let queries = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    queries += 1;
    if (control.unavailable) throw new Error('synthetic grant store unavailable');
    if (sql.includes('SELECT learner_id FROM parent_learner_grants')) {
      return {rows: values[0] === OPENID && !control.revoked ? [{learner_id: 'lrn_owned'}] : []};
    }
    if (sql.includes('UPDATE parent_learner_grants')) {
      control.revoked = true;
      return {rows: [], rowCount: 1};
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const pool = {query} as unknown as NonNullable<ParentAccessOptions['postgresPool']>;
  const calls: string[] = [];
  const store = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        if (!['getRegistration', 'getTeacherGradeRateSchedule'].includes(String(property))) {
          throw new Error(`Preview must not call ${String(property)}`);
        }
        return Reflect.apply(value, object, args);
      };
    },
  });
  return {target, store, pool, calls, control, queryCount: () => queries};
}
const parentHeaders = (openid = OPENID) => ({'x-mea-parent-session': buildSignedParentToken(openid)});
const familyHeaders = () => ({'x-mea-session': buildSignedFamilyToken()});
const previewUrl = (id = 'reg_owned') => `/parent/registrations/${id}/checkout-preview`;

describe('grant-scoped parent checkout preview', () => {
  it('rejects missing, wrong-role, forged and expired sessions before storage access', async () => {
    const {store, pool, calls, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    const expiredPayload = `parent.v1.${Buffer.from(OPENID).toString('base64url')}.${Math.floor(Date.now() / 1000) - 1}`;
    try {
      for (const headers of [{}, familyHeaders(),
        {authorization: `Bearer ${buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32))}`},
        {'x-mea-parent-session': buildSignedParentToken(OPENID) + 'x'},
        {'x-mea-parent-session': `${expiredPayload}.${signSessionPayload(expiredPayload)}`},
      ]) {
        const response = await app.inject({method: 'GET', url: previewUrl(), headers});
        assert.equal(response.statusCode, 401);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(queryCount(), 0);
      assert.deepEqual(calls, []);
    } finally { await app.close(); }
  });

  it('denies cross-owner and unknown registrations before pricing access, ignoring identity hints', async () => {
    const {store, pool, calls} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const id of ['reg_other', 'reg_missing']) {
        const response = await app.inject({method: 'GET',
          url: `${previewUrl(id)}?learner_id=lrn_owned&parent_openid=${OPENID}`, headers: parentHeaders()});
        assert.equal(response.statusCode, 404);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json(), {error: 'REGISTRATION_NOT_FOUND'});
      }
      assert.deepEqual(calls, ['getRegistration', 'getRegistration']);
      const ungranted = await app.inject({method: 'GET', url: previewUrl(),
        headers: parentHeaders('synthetic_ungranted_parent')});
      assert.equal(ungranted.statusCode, 404);
      assert.equal(calls.length, 2);
    } finally { await app.close(); }
  });

  it('quotes only the stored registration fee without private pricing fields, financial writes or a level freeze', async () => {
    const {store, target, pool} = fixture();
    const before = JSON.stringify(target.listRegistrations());
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const [id, level, fee, yuan] of [
        ['reg_owned', 3, 52700, '¥527.00'], ['reg_default', 5, 53500, '¥535.00'], ['reg_builtin', 8, 58000, '¥580.00'],
      ] as const) {
        const response = await app.inject({method: 'GET', url: previewUrl(id), headers: parentHeaders()});
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json(), {status: 'preview_only', payment_available: false,
          quote: {registration_id: id, level, currency: 'CNY', exam_fee_fen: fee, exam_fee_yuan: yuan}});
        assert.equal(target.hasRegistrationPayment(id), false);
      }
      assert.equal(JSON.stringify(target.listRegistrations()), before);
      const updated = target.updateRegistrationDetails('reg_owned', {level: 4});
      assert.equal(updated?.level, 4);
      const refreshed = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
      assert.equal(refreshed.json().quote.exam_fee_fen, 48000);

      const paidOrder = target.payRegistrationOrder({registration_id: 'reg_owned'}).order;
      const paidBefore = JSON.stringify(paidOrder);
      const repeated = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
      assert.equal(repeated.json().status, 'preview_only');
      assert.equal(JSON.stringify(paidOrder), paidBefore);
    } finally { await app.close(); }
  });

  it('rejects all client pricing and identity overrides before reading the rate schedule', async () => {
    const {store, pool, calls} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const field of ['teacher_id', 'learner_id', 'parent_openid', 'level', 'amount_fen',
        'addon_ids', 'wx_transaction_id', 'status']) {
        const response = await app.inject({method: 'GET', url: `${previewUrl()}?${field}=forged`,
          headers: parentHeaders()});
        assert.equal(response.statusCode, 400, field);
        assert.equal(response.headers['cache-control'], 'no-store');
      }
      assert.equal(calls.includes('getTeacherGradeRateSchedule'), false);
    } finally { await app.close(); }
  });

  it('fails closed for invalid stored levels, invalid prices, revocation and grant-storage failure', async () => {
    const {store, target, pool, calls, control} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      target.getRegistration('reg_owned')!.level = 11;
      const invalidLevel = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
      assert.equal(invalidLevel.statusCode, 409);
      assert.equal(calls.includes('getTeacherGradeRateSchedule'), false);
      target.getRegistration('reg_owned')!.level = 3;
      for (const price of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        target.upsertTeacherGradeRateCard({teacher_id: 'tch_synthetic', level: 3,
          exam_fee_fen: price, concession_fen: 7000});
        const invalidPrice = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
        assert.equal(invalidPrice.statusCode, 409);
        assert.deepEqual(invalidPrice.json(), {error: 'REGISTRATION_PRICING_UNAVAILABLE'});
      }
      const revoked = await app.inject({method: 'DELETE', url: '/parent/learners/lrn_owned/grant',
        headers: familyHeaders(), payload: {parent_openid: OPENID}});
      assert.equal(revoked.statusCode, 200);
      const beforeCalls = calls.length;
      const denied = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
      assert.equal(denied.statusCode, 404);
      assert.equal(calls.length, beforeCalls);
      control.unavailable = true;
      const unavailable = await app.inject({method: 'GET', url: previewUrl(), headers: parentHeaders()});
      assert.equal(unavailable.statusCode, 500);
      assert.equal(unavailable.headers['cache-control'], 'no-store');
      assert.equal(calls.length, beforeCalls);
    } finally { await app.close(); }
  });

  it('keeps payment writes and teacher financial data admin-only', async () => {
    const {store, pool, calls, queryCount} = fixture();
    const app = buildApp({store, parentAccess: {postgresPool: pool}});
    try {
      for (const url of ['/payments/checkout', '/rpc/paymentCheckout']) {
        const response = await app.inject({method: 'POST', url, headers: parentHeaders(),
          payload: {registration_id: 'reg_owned', reg_id: 'reg_owned', wx_transaction_id: 'forged'}});
        assert.equal(response.statusCode, 401);
      }
      const wallet = await app.inject({method: 'GET', url: '/concessions/wallet', headers: parentHeaders()});
      assert.equal(wallet.statusCode, 401);
      assert.deepEqual(calls, []);
      assert.equal(queryCount(), 0);
    } finally { await app.close(); }
  });

  it('uses the scoped Mini Program preview transport and keeps payment and CloudBase fallback disabled', async () => {
    const source = readFileSync(resolve(__dirname, '../../../../apps/wechat-mini/miniprogram/utils/api.js'), 'utf8')
      .replace(/^export const /gm, 'const ').replace(/^export default /m, 'globalThis.api = ');
    const requests: Array<Record<string, any>> = [];
    let cloudCalls = 0;
    let mode = 'success';
    const context: Record<string, any> = {wx: {
      getStorageSync: (key: string) => key === 'MEA_PARENT_SESSION' ? 'synthetic-token' : '',
      cloud: {callFunction: () => { cloudCalls += 1; }},
      request: (request: Record<string, any>) => {
        requests.push(request);
        if (mode === 'network') return request.fail({errMsg: 'synthetic network failure'});
        request.success({statusCode: mode === 'denied' ? 404 : 200,
          data: mode === 'denied' ? {error: 'REGISTRATION_NOT_FOUND'} : {status: 'preview_only', payment_available: false}});
      },
    }};
    runInNewContext(source, context);
    const preview = await context.api.paymentCheckoutPreview('reg_owned/encoded');
    assert.equal(preview.payment_available, false);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url, 'https://mea.xgar.com.cn/parent/registrations/reg_owned%2Fencoded/checkout-preview');
    assert.equal(requests[0].header['X-Mea-Parent-Session'], 'synthetic-token');
    assert.equal(requests[0].data, undefined);
    await assert.rejects(context.api.paymentCheckoutPreview(), /编号/);
    await assert.rejects(context.api.paymentCheckout('reg_owned', 'forged_teacher'), /尚未开放/);
    assert.equal(requests.length, 1);
    mode = 'denied';
    await assert.rejects(context.api.paymentCheckoutPreview('reg_owned'), /REGISTRATION_NOT_FOUND/);
    mode = 'network';
    await assert.rejects(context.api.paymentCheckoutPreview('reg_owned'), /network failure/);
    assert.equal(cloudCalls, 0);
  });

  it('clears stale detail and preview data on reload or denied access and ignores old responses', async () => {
    const source = readFileSync(resolve(__dirname,
      '../../../../apps/wechat-mini/miniprogram/pages/registration/detail/detail.js'), 'utf8')
      .replace("import api from '../../../utils/api';", 'const api = globalThis.mockApi;');
    let page: any;
    let denied = false;
    let delayed = false;
    let finishPreview: ((value: unknown) => void) | undefined;
    const preview = {status: 'preview_only', payment_available: false, quote: {exam_fee_yuan: '¥527.00'}};
    const context = {
      Page: (definition: unknown) => { page = definition; },
      getApp: () => ({ensureLogin: async () => {}}),
      console: {error: () => {}},
      wx: {showToast: () => {}},
      mockApi: {
        registrationGet: async () => {
          if (denied) throw new Error('REGISTRATION_NOT_FOUND');
          return {id: 'reg_owned', status: 'draft', workflow_status: 'draft'};
        },
        paymentCheckoutPreview: async () => {
          if (denied) throw new Error('REGISTRATION_NOT_FOUND');
          if (delayed) return new Promise(resolve => { finishPreview = resolve; });
          return preview;
        },
      },
    };
    runInNewContext(source, context);
    page.data = structuredClone(page.data);
    page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch);
    await page.onLoad({id: 'reg_owned'});
    await page.onPreviewCheckout();
    assert.equal(page.data.checkoutPreview, preview);
    assert.equal(page.data.previewLoading, false);
    delayed = true;
    const pending = page.onPreviewCheckout();
    assert.equal(page.data.checkoutPreview, null);
    await page.load();
    assert.ok(finishPreview);
    finishPreview!(preview);
    await pending;
    assert.equal(page.data.checkoutPreview, null);
    denied = true;
    await page.onPreviewCheckout();
    assert.equal(page.data.checkoutPreview, null);
    assert.equal(page.data.previewLoading, false);
    await page.load();
    assert.equal(page.data.reg, null);
    assert.equal(page.data.checkoutPreview, null);
    assert.equal(page.data.loading, false);
    assert.equal(page.onUploadPortrait, undefined);
  });
});
