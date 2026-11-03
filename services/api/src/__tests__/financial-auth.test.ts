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
  process.env.SESSION_SIGNING_KEY = 'synthetic-financial-auth-key-at-least-32-bytes';
  process.env.ENABLE_LIVE_STORAGE = '0';
  delete process.env.WECOM_RELAY_TOKEN;
});

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

const teacherId = 'tch_finance_auth';
const familyToken = () => buildSignedFamilyToken();
const teacherToken = () => buildSignedTeacherToken(68, 't_inv_68_' + 'a'.repeat(32));
const financialMethods = [
  'getTeacherGradeRateSchedule', 'upsertTeacherGradeRateCard', 'payRegistrationOrder',
  'getTeacherConcessionWallet', 'confirmAndAdjustConcession', 'requestTeacherWithdrawal',
  'payoutTeacherWithdrawal',
];

function financialFixture() {
  const store = new DomainRepository();
  const learner = store.createLearner({
    id: 'lrn_financial_auth', name_cn: '合成财务学员', gender: '女', dob: '2016-01-02',
    id_type: '身份证', id_number: '110101201601021234', guardian_phone: '13800138000',
  });
  const registration = store.createRegistration({
    id: 'reg_financial_auth', learner_id: learner.id, teacher_id: teacherId,
    cycle_id: '2025-summer', subject_id: 'piano', level: 5,
  });
  return {store, registration};
}

function lockRegistration(store: DomainRepository, id: string) {
  store.transitionRegistration({id, to_status: 'submitted'});
  store.transitionRegistration({id, to_status: 'locked'});
}

describe('financial authorization', () => {
  it('denies anonymous and teacher credentials before every financial repository operation', async () => {
    const store = new DomainRepository();
    let repositoryCalls = 0;
    for (const method of financialMethods) {
      const original = (store as any)[method].bind(store);
      (store as any)[method] = (...args: any[]) => {
        repositoryCalls += 1;
        return original(...args);
      };
    }
    const app = buildApp({store});

    try {
      const directRequests = [
        {method: 'GET' as const, url: '/concessions/rate-cards?teacher_id=tch_finance_auth'},
        {method: 'PUT' as const, url: '/concessions/rate-cards', payload: {
          teacher_id: teacherId, level: 5, exam_fee_fen: 45000, concession_fen: 8000,
        }},
        {method: 'POST' as const, url: '/payments/checkout', payload: {
          registration_id: 'reg_financial_auth', teacher_id: teacherId,
        }},
        {method: 'GET' as const, url: '/concessions/wallet?teacher_id=tch_finance_auth'},
        {method: 'PATCH' as const, url: '/concessions/ledger_financial_auth/confirm', payload: {}},
        {method: 'POST' as const, url: '/concessions/withdrawals', payload: {teacher_id: teacherId}},
        {method: 'PATCH' as const, url: '/concessions/withdrawals/withdrawal_financial_auth/payout', payload: {}},
      ];
      const rpcActions = [
        'teacherRateCardsGet', 'adminUpsertTeacherRateCard', 'paymentCheckout',
        'teacherConcessionWallet', 'adminConfirmConcession', 'teacherRequestWithdrawal',
        'adminPayoutWithdrawal',
      ];
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
      assert.equal(repositoryCalls, 0);
    } finally {
      await app.close();
    }
  });

  it('preserves the admin direct checkout, concession, withdrawal and payout workflow', async () => {
    const {store, registration} = financialFixture();
    const app = buildApp({store});
    const responses = [];

    try {
      const rates = await app.inject({method: 'GET', url: `/concessions/rate-cards?teacher_id=${teacherId}`,
        headers: {'x-mea-session': familyToken()}});
      assert.equal(rates.statusCode, 200, rates.body);
      responses.push(rates);
      const updatedRate = await app.inject({method: 'PUT', url: '/concessions/rate-cards',
        headers: {authorization: `Bearer ${familyToken()}`}, payload: {
          teacher_id: teacherId, level: 5, exam_fee_fen: 45000, concession_fen: 8000,
        }});
      assert.equal(updatedRate.statusCode, 200, updatedRate.body);
      responses.push(updatedRate);
      const checkout = await app.inject({method: 'POST', url: '/payments/checkout',
        headers: {cookie: familySessionCookie(familyToken()).split(';')[0]}, payload: {
          registration_id: registration.id, teacher_id: teacherId,
        }});
      assert.equal(checkout.statusCode, 201, checkout.body);
      assert.equal(checkout.json().order.amount_fen, 45000);
      responses.push(checkout);

      lockRegistration(store, registration.id);
      const wallet = await app.inject({method: 'GET', url: `/concessions/wallet?teacher_id=${teacherId}`,
        headers: {'x-mea-session': familyToken()}});
      assert.equal(wallet.statusCode, 200, wallet.body);
      assert.equal(wallet.json().summary.accrued_fen, 8000);
      const ledgerId = wallet.json().ledger[0].id;
      responses.push(wallet);
      const confirmed = await app.inject({method: 'PATCH', url: `/concessions/${ledgerId}/confirm`,
        headers: {authorization: `Bearer ${familyToken()}`}, payload: {adjusted_amount_fen: 9000}});
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      responses.push(confirmed);
      const withdrawal = await app.inject({method: 'POST', url: '/concessions/withdrawals',
        headers: {cookie: familySessionCookie(familyToken()).split(';')[0]}, payload: {teacher_id: teacherId}});
      assert.equal(withdrawal.statusCode, 201, withdrawal.body);
      responses.push(withdrawal);
      const payout = await app.inject({method: 'PATCH',
        url: `/concessions/withdrawals/${withdrawal.json().withdrawal.id}/payout`,
        headers: {'x-mea-session': familyToken()}, payload: {payout_ref: 'synthetic-payout'}});
      assert.equal(payout.statusCode, 200, payout.body);
      assert.equal(payout.json().status, 'approved_paid');
      responses.push(payout);
      for (const response of responses) assert.equal(response.headers['cache-control'], 'no-store');
    } finally {
      await app.close();
    }
  });

  it('preserves the same admin financial workflow through protected RPC actions', async () => {
    const {store, registration} = financialFixture();
    const app = buildApp({store});
    const headers = {'x-mea-session': familyToken()};
    const call = (action: string, payload: Record<string, unknown>) =>
      app.inject({method: 'POST', url: `/rpc/${action}`, headers, payload});

    try {
      const rates = await call('teacherRateCardsGet', {teacher_id: teacherId});
      assert.equal(rates.statusCode, 200, rates.body);
      assert.equal(rates.json().success, true);
      const updatedRate = await call('adminUpsertTeacherRateCard', {
        teacher_id: teacherId, level: 5, exam_fee_fen: 45000, concession_fen: 8000,
      });
      assert.equal(updatedRate.statusCode, 200, updatedRate.body);
      const checkout = await call('paymentCheckout', {
        registration_id: registration.id, teacher_id: teacherId,
      });
      assert.equal(checkout.statusCode, 200, checkout.body);
      assert.equal(checkout.json().data.order.amount_fen, 45000);

      lockRegistration(store, registration.id);
      const wallet = await call('teacherConcessionWallet', {teacher_id: teacherId});
      assert.equal(wallet.statusCode, 200, wallet.body);
      assert.equal(wallet.json().data.summary.accrued_fen, 8000);
      const ledgerId = wallet.json().data.ledger[0].id;
      const confirmed = await call('adminConfirmConcession', {
        ledger_id: ledgerId, adjusted_amount_fen: 9000,
      });
      assert.equal(confirmed.statusCode, 200, confirmed.body);
      const withdrawal = await call('teacherRequestWithdrawal', {teacher_id: teacherId});
      assert.equal(withdrawal.statusCode, 200, withdrawal.body);
      const payout = await call('adminPayoutWithdrawal', {
        withdrawal_id: withdrawal.json().data.withdrawal.id, payout_ref: 'synthetic-rpc-payout',
      });
      assert.equal(payout.statusCode, 200, payout.body);
      assert.equal(payout.json().data.status, 'approved_paid');
      for (const response of [rates, updatedRate, checkout, wallet, confirmed, withdrawal, payout]) {
        assert.equal(response.headers['cache-control'], 'no-store');
      }
    } finally {
      await app.close();
    }
  });
});
