import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeChatSignature } from '@musicexamaid/shared';
import { buildApp } from '../app';

describe('API baseline, E2E workflow & WeChat/WeCom integration routes', () => {
  it('GET /health returns 200 ok with dependency statuses', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.dependencies.postgres.status, 'stub');
    await app.close();
  });

  it('POST /learners & GET /learners/:id persist learner with masked ID', async () => {
    const app = buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '张小琴',
        gender: '女',
        dob: '2016-05-01',
        id_type: '身份证',
        id_number: '110101201605011234',
        guardian_phone: '13800138000',
      },
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json();
    assert.equal(created.id_last4, '1234');
    assert.equal(created.id_number, undefined);

    const getRes = await app.inject({
      method: 'GET',
      url: `/learners/${created.id}`,
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.json().name_cn, '张小琴');
    await app.close();
  });

  it('Full E2E workflow: create learner -> draft -> submitted -> confirmed -> locked (snapshot) -> export', async () => {
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

    // 2. Create draft registration
    const regRes = await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: learner.id,
        institution_id: 'INST_01',
        cycle_id: '2025-summer',
        subject_id: '钢琴',
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

    // 4. Teacher confirms: submitted -> confirmed
    const confRes = await app.inject({
      method: 'PATCH',
      url: `/registrations/${reg.id}/status`,
      payload: { to_status: 'confirmed', teacher_notes: '曲目与级别核对通过' },
    });
    assert.equal(confRes.statusCode, 200);
    assert.equal(confRes.json().status, 'confirmed');

    // 5. Teacher locks: confirmed -> locked (writes snapshot_json)
    const lockRes = await app.inject({
      method: 'PATCH',
      url: `/registrations/${reg.id}/status`,
      payload: { to_status: 'locked' },
    });
    assert.equal(lockRes.statusCode, 200);
    const locked = lockRes.json();
    assert.equal(locked.status, 'locked');
    assert.equal(locked.has_snapshot, true);
    assert.deepEqual(locked.missing_flags, []);

    // 6. Export batch uses locked snapshot_json
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
    assert.equal(exported.preview_rows[0]['证件号码'], '440101201503159876');
    assert.equal(exported.preview_rows[0]['考试曲目1'], '巴赫创意曲');
    assert.equal(exported.preview_rows[0]['考试曲目2'], '贝多芬奏鸣曲');
    assert.equal(exported.preview_rows[0]['考试曲目3'], '');

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

  it('GET /webhooks/wechat-mp rejects invalid signature with 403', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/wechat-mp?signature=bad_sig&timestamp=1760000000&nonce=n1&echostr=hello',
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('POST /notifications/wechat-mp builds Service Account template message deep-linking to Mini Program', async () => {
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
    assert.equal(body.payload.miniprogram.appid, 'wxaf3466a310a8bd07');
    assert.ok(
      body.payload.miniprogram.pagepath.includes('reg_888'),
      'Expected pagepath to deep-link to registration ID',
    );
    await app.close();
  });
});
