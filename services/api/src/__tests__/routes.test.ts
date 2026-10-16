import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeChatSignature } from '@musicexamaid/shared';
import { buildApp } from '../app';

describe('API baseline, 1-click lock, CSV export & Service Account H5 Web App', () => {
  it('GET /health returns 200 ok with dependency statuses', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.dependencies.postgres.status, 'stub');
    await app.close();
  });

  it('GET /app serves the WeChat Service Account & WeCom H5 tool and menu config', async () => {
    const app = buildApp();
    const appRes = await app.inject({ method: 'GET', url: '/app?tab=parent' });
    assert.equal(appRes.statusCode, 200);
    assert.ok(String(appRes.headers['content-type']).includes('text/html'));
    assert.ok(appRes.body.includes('考级助手 · 服务号与企微工作台'));

    const menuRes = await app.inject({
      method: 'GET',
      url: '/webhooks/wechat-mp/menu-config',
    });
    assert.equal(menuRes.statusCode, 200);
    const menu = menuRes.json();
    assert.equal(menu.button.length, 3);
    assert.equal(menu.button[0].name, '我要报名');
    await app.close();
  });

  it('Full optimized E2E workflow: learner -> draft -> submitted -> 1-click locked -> CSV download', async () => {
    const app = buildApp();

    // 1. Create learner
    const lrnRes = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '陈小乐',
        gender: '男',
        dob: '2015-03-15',
        id_type: '身份证',
        id_number: '440101201503159876',
        guardian_phone: '13600136000',
      },
    });
    const learner = lrnRes.json();

    // 2. Create draft registration with subject_id="piano"
    const regRes = await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: learner.id,
        institution_id: 'INST_01',
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 7,
        exam_mode: '现场',
        repertoire: ['巴赫创意曲', '贝多芬奏鸣曲'],
      },
    });
    assert.equal(regRes.statusCode, 201);
    const reg = regRes.json();
    assert.equal(reg.status, 'draft');

    // 3. Parent submits: draft -> submitted
    const subRes = await app.inject({
      method: 'PATCH',
      url: `/registrations/${reg.id}/status`,
      payload: { to_status: 'submitted' },
    });
    assert.equal(subRes.statusCode, 200);
    assert.equal(subRes.json().status, 'submitted');

    // 4. Teacher 1-click Confirm & Lock: submitted -> locked
    const lockRes = await app.inject({
      method: 'PATCH',
      url: `/registrations/${reg.id}/status`,
      payload: { to_status: 'locked', teacher_notes: '一键审核并锁定' },
    });
    assert.equal(lockRes.statusCode, 200);
    const locked = lockRes.json();
    assert.equal(locked.status, 'locked');
    assert.equal(locked.has_snapshot, true);
    assert.deepEqual(locked.missing_flags, []);

    // 5. Export batch & download Template v2.1 CSV
    const expRes = await app.inject({
      method: 'POST',
      url: '/exports',
      payload: {
        cycle_id: '2025-summer',
        batch_type: 'super',
        registration_ids: [reg.id],
      },
    });
    assert.equal(expRes.statusCode, 202);
    const exported = expRes.json();
    assert.equal(exported.preview_rows.length, 1);
    assert.equal(exported.preview_rows[0]['姓名'], '陈小乐');
    assert.equal(exported.preview_rows[0]['报考专业'], '钢琴');
    assert.equal(exported.preview_rows[0]['证件号码'], '440101201503159876');

    const csvRes = await app.inject({
      method: 'GET',
      url: exported.download_csv_url,
    });
    assert.equal(csvRes.statusCode, 200);
    assert.ok(String(csvRes.headers['content-type']).includes('text/csv'));
    assert.ok(csvRes.body.includes('"\t440101201503159876"'));
    assert.ok(csvRes.body.includes('"钢琴"'));

    await app.close();
  });

  it('PATCH /registrations/:id/status rejects invalid status transition with 409', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/registrations/reg_123/status',
      payload: {
        from_status: 'draft',
        to_status: 'locked',
      },
    });
    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.error, 'INVALID_STATUS_TRANSITION');
    await app.close();
  });

  it('GET /webhooks/wechat-mp verifies valid SHA1 signature and echoes echostr', async () => {
    const app = buildApp();
    const token = process.env.WECHAT_MP_TOKEN || 'dev_wechat_mp_token';
    const timestamp = '1760000000';
    const nonce = 'nonce123';
    const echostr = 'echo_verified_ok';
    const signature = computeWeChatSignature(token, timestamp, nonce);

    const res = await app.inject({
      method: 'GET',
      url: `/webhooks/wechat-mp?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=${echostr}`,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, echostr);
    await app.close();
  });

  it('POST /notifications/wechat-mp builds Service Account template message with H5 url and Mini Program fallback', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/wechat-mp',
      payload: {
        mp_openid: 'oMP_parent_123',
        registration_id: 'reg_888',
        to_status: 'needs_change',
        teacher_notes: '请重新上传清晰蓝底证件照',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.channel, 'wechat_mp');
    assert.equal(body.payload.touser, 'oMP_parent_123');
    assert.ok(body.payload.url.includes('/app?tab=parent&reg_id=reg_888'));
    assert.equal(body.payload.miniprogram.appid, 'wxaf3466a310a8bd07');
    await app.close();
  });
});
