import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeChatSignature } from '@musicexamaid/shared';
import { buildApp } from '../app';

describe('API baseline, 1-click lock, ZIP/CSV export, RPC bridge & Service Account H5 Web App', () => {
  it('GET /health returns 200 ok with stub and live dependency probes', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.dependencies.postgres.status, 'stub');

    const liveRes = await app.inject({ method: 'GET', url: '/health?live=1' });
    assert.equal(liveRes.statusCode, 200);
    const liveBody = liveRes.json();
    assert.ok(['ok', 'degraded'].includes(liveBody.status));
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

  it('Full optimized E2E workflow: learner -> draft -> submitted -> 1-click locked -> CSV & ZIP bundle download', async () => {
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

    // 1b. Upload portrait photo for learner
    const customJpeg = Buffer.from('FFD8FFE000104A464946', 'hex');
    const photoRes = await app.inject({
      method: 'POST',
      url: `/learners/${learner.id}/photo`,
      payload: { photo_base64: customJpeg.toString('base64') },
    });
    assert.equal(photoRes.statusCode, 200);
    assert.equal(photoRes.json().size_bytes, customJpeg.length);

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

    // 4b. Run SuperBatch dedup preflight
    const preflightRes = await app.inject({
      method: 'POST',
      url: '/exports/dedup-preflight',
      payload: { cycle_id: '2025-summer' },
    });
    assert.equal(preflightRes.statusCode, 200);
    assert.equal(preflightRes.json().ready_to_export, true);
    assert.deepEqual(preflightRes.json().included_ids, [reg.id]);

    // 5. Export batch -> verify photo_paths, CSV download & ZIP bundle download
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
    assert.deepEqual(exported.photo_paths, [
      'photos/440101201503159876_陈小乐.jpg',
    ]);

    const csvRes = await app.inject({
      method: 'GET',
      url: exported.download_csv_url,
    });
    assert.equal(csvRes.statusCode, 200);
    assert.ok(String(csvRes.headers['content-type']).includes('text/csv'));
    assert.ok(csvRes.body.includes('"\t440101201503159876"'));
    assert.ok(csvRes.body.includes('"钢琴"'));

    const zipRes = await app.inject({
      method: 'GET',
      url: exported.download_zip_url,
    });
    assert.equal(zipRes.statusCode, 200);
    assert.ok(String(zipRes.headers['content-type']).includes('application/zip'));
    // Verify PKZIP magic bytes (0x50 0x4b 0x03 0x04 -> "PK\x03\x04")
    assert.equal(zipRes.rawPayload.slice(0, 2).toString('utf8'), 'PK');
    assert.ok(
      zipRes.rawPayload.includes(
        Buffer.from('photos/440101201503159876_陈小乐.jpg', 'utf8'),
      ),
    );
    assert.ok(
      zipRes.rawPayload.includes(Buffer.from('报名汇总表.csv', 'utf8')),
    );

    await app.close();
  });

  it('POST /rpc/:action supports zero-rewrite Mini Program cutover flow', async () => {
    const app = buildApp();

    const subRes = await app.inject({
      method: 'POST',
      url: '/rpc/getDictSubjects',
      payload: {},
    });
    assert.equal(subRes.statusCode, 200);
    assert.equal(subRes.json().success, true);
    assert.ok(subRes.json().data.length >= 11);

    const lrnRes = await app.inject({
      method: 'POST',
      url: '/rpc/learnerUpsert',
      payload: {
        name_cn: '林小琴',
        gender: '女',
        dob: '2017-06-01',
        id_type: '身份证',
        id_number: '330101201706014321',
        guardian_phone: '13500135000',
      },
    });
    assert.equal(lrnRes.json().success, true);
    const learnerId = lrnRes.json().data._id;

    const regRes = await app.inject({
      method: 'POST',
      url: '/rpc/registrationCreate',
      payload: {
        learner_id: learnerId,
        cycle_id: '2025-summer',
        subject_id: 'violin',
        level: 4,
      },
    });
    const regId = regRes.json().data._id;

    await app.inject({
      method: 'POST',
      url: '/rpc/registrationSubmit',
      payload: { reg_id: regId },
    });

    const lockRes = await app.inject({
      method: 'POST',
      url: '/rpc/teacherLock',
      payload: { reg_id: regId },
    });
    assert.equal(lockRes.json().success, true);
    assert.equal(lockRes.json().data.status, 'locked');

    const expRes = await app.inject({
      method: 'POST',
      url: '/rpc/superBatchExportOnce',
      payload: { cycle_id: '2025-summer' },
    });
    assert.equal(expRes.json().success, true);
    assert.ok(expRes.json().data.tempFileURL.endsWith('/bundle.zip'));

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

  it('Persists learner, portrait photo, registration, and export ZIP to live Postgres & MinIO S3 (100.64.0.4)', async () => {
    const app = buildApp();
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health?live=1',
    });
    const deps = healthRes.json().dependencies;
    if (deps.postgres.status !== 'ok' || deps.s3.status !== 'ok') {
      await app.close();
      return;
    }

    const createRes = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '周星辰',
        gender: '男',
        dob: '2016-09-10',
        id_type: '身份证',
        id_number: '310101201609108888',
        guardian_phone: '13900139000',
        persist_db: true,
      },
    });
    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.json().pg_synced, true);
    const learnerId = createRes.json().id;

    const photoRes = await app.inject({
      method: 'POST',
      url: `/learners/${learnerId}/photo`,
      payload: {
        photo_base64: Buffer.from('\xff\xd8\xff\xe0LIVE_S3_JPEG\xff\xd9').toString(
          'base64',
        ),
        persist_s3: true,
        persist_db: true,
      },
    });
    assert.equal(photoRes.statusCode, 200);
    assert.ok(String(photoRes.json().s3_uri).startsWith('s3://'));

    const regRes = await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: learnerId,
        cycle_id: '2025-summer',
        subject_id: 'guzheng',
        level: 7,
      },
    });
    const regId = regRes.json().id;

    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'submitted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'locked' },
    });

    const expRes = await app.inject({
      method: 'POST',
      url: '/exports',
      payload: {
        cycle_id: '2025-summer',
        registration_ids: [regId],
        persist_db: true,
        persist_s3: true,
      },
    });
    assert.equal(expRes.statusCode, 202);
    assert.equal(expRes.json().pg_synced, true);
    assert.ok(String(expRes.json().s3_export_uri).endsWith('.zip'));

    const { closePool } = await import('../store/postgres.js');
    await closePool();
    await app.close();
  });

  it('Per-teacher & per-grade custom pricing/concession -> WeChat Pay -> Teacher lock accrues custom rate -> Admin adjusts & confirms -> Teacher withdraws', async () => {
    const app = buildApp();

    // 0. Configure custom Grade 5 rate card for Senior Partner Teacher Zhang:
    //    Student pays ¥450 (45000 fen, vs default ¥480), Teacher Zhang accrues ¥80 (8000 fen, vs default ¥50)
    const rateRes = await app.inject({
      method: 'PUT',
      url: '/concessions/rate-cards',
      payload: {
        teacher_id: 'tch_zhang',
        level: 5,
        exam_fee_fen: 45000,
        concession_fen: 8000,
        note: '资深合伙老师 5级专属协议价',
      },
    });
    assert.equal(rateRes.statusCode, 200);
    assert.equal(rateRes.json().exam_fee_yuan, '¥450.00');
    assert.equal(rateRes.json().concession_yuan, '¥80.00');

    const learnerRes = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '林小音',
        gender: '女',
        dob: '2017-04-12',
        id_type: '身份证',
        id_number: '310101201704126666',
        guardian_phone: '13700137000',
      },
    });
    const learnerId = learnerRes.json().id;

    const regRes = await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: learnerId,
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 5,
      },
    });
    const regId = regRes.json().id;

    // 1. Parent pays via WeChat Pay under Teacher Zhang -> charged ¥450.00 (teacher_custom rate)
    const payRes = await app.inject({
      method: 'POST',
      url: '/payments/checkout',
      payload: {
        registration_id: regId,
        teacher_id: 'tch_zhang',
      },
    });
    assert.equal(payRes.statusCode, 201);
    assert.equal(payRes.json().order.amount_fen, 45000);
    assert.equal(payRes.json().order.amount_yuan, '¥450.00');
    assert.equal(payRes.json().order.rate_source, 'teacher_custom');

    // 2. Teacher submits & 1-click locks -> automatically accrues Teacher Zhang's Grade 5 rate: ¥80 (8000 fen)
    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'submitted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'locked' },
    });

    const walletRes1 = await app.inject({
      method: 'GET',
      url: '/concessions/wallet?teacher_id=tch_zhang',
    });
    assert.equal(walletRes1.statusCode, 200);
    const w1 = walletRes1.json();
    assert.equal(w1.summary.accrued_fen, 8000);
    assert.equal(w1.summary.available_fen, 0);
    assert.equal(w1.ledger[0].rate_source, 'teacher_custom');
    const ledgerId = w1.ledger[0].id;

    // 3. Admin confirms and adjusts concession on the fly from ¥80 -> ¥95 (9500 fen)
    const confirmRes = await app.inject({
      method: 'PATCH',
      url: `/concessions/${ledgerId}/confirm`,
      payload: {
        adjusted_amount_fen: 9500,
        adjustment_note: '资深合伙协议 ¥80 + 满员额外奖励 ¥15',
        confirmed_by: 'admin_flintstone',
      },
    });
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(confirmRes.json().status, 'confirmed');
    assert.equal(confirmRes.json().adjusted_amount_yuan, '¥95.00');

    // 4. Teacher requests withdrawal of confirmed balance (¥95.00)
    const wdRes = await app.inject({
      method: 'POST',
      url: '/concessions/withdrawals',
      payload: {
        teacher_id: 'tch_zhang',
        teacher_note: '2025暑期考级第一批提现',
      },
    });
    assert.equal(wdRes.statusCode, 201);
    assert.equal(wdRes.json().withdrawal.total_amount_fen, 9500);
    assert.equal(wdRes.json().withdrawal.total_amount_yuan, '¥95.00');
    const withdrawalId = wdRes.json().withdrawal.id;

    // 5. Admin approves & marks withdrawal paid out
    const payoutRes = await app.inject({
      method: 'PATCH',
      url: `/concessions/withdrawals/${withdrawalId}/payout`,
      payload: {
        admin_note: '已通过微信转账打款',
        payout_ref: 'wx_payout_20261016',
      },
    });
    assert.equal(payoutRes.statusCode, 200);
    assert.equal(payoutRes.json().status, 'approved_paid');

    const walletRes2 = await app.inject({
      method: 'GET',
      url: '/concessions/wallet?teacher_id=tch_zhang',
    });
    const w2 = walletRes2.json();
    assert.equal(w2.summary.available_fen, 0);
    assert.equal(w2.summary.withdrawing_fen, 0);
    assert.equal(w2.summary.paid_out_fen, 9500);
    assert.equal(w2.summary.paid_out_yuan, '¥95.00');

    await app.close();
  });

  it('Official portal (kjzx002120) QR auth parser & cross-channel consolidation merges official_only, matched_both, helper_only, and accrues teacher concessions', async () => {
    const app = buildApp();

    // 1. Parse official login page HTML structure from kjzx002120.kj5.zgyyxykj.com/admins
    const qrRes = await app.inject({
      method: 'POST',
      url: '/official-sync/qr-session',
      payload: {
        mock_php_sess_id: '199fc2mblsffjmuc569dpopi9h',
        mock_html: `
          <div class="qr-lg-title">江西小戈尔文化艺术有限公司考级办管理后台</div>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAA==" alt="">
          <script>interV = get_wxauth_status('w06xSJ3ovW', function() {});</script>
        `,
      },
    });
    assert.equal(qrRes.statusCode, 200);
    assert.equal(qrRes.json().php_sess_id, '199fc2mblsffjmuc569dpopi9h');
    assert.equal(qrRes.json().wxauth_token, 'w06xSJ3ovW');
    assert.equal(qrRes.json().portal_title, '江西小戈尔文化艺术有限公司考级办管理后台');

    // 2. Seed two helper registrations:
    //    - Student A (陈小乐, last4 9876, Piano Grade 5) -> helper_only
    //    - Student B (林小音, last4 6666, Piano Grade 5) -> will also appear in official portal (matched_both)
    const lrnA = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '陈小乐',
        gender: '女',
        dob: '2016-03-15',
        id_type: '身份证',
        id_number: '440101201603159876',
        guardian_phone: '13800138001',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: lrnA.json().id,
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 5,
      },
    });

    const lrnB = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '林小音',
        gender: '女',
        dob: '2017-04-12',
        id_type: '身份证',
        id_number: '310101201704126666',
        guardian_phone: '13800138002',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: lrnB.json().id,
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 5,
      },
    });

    // 3. Consolidate with official website registrations:
    //    - 林小音 (same Piano Grade 5 -> matched_both)
    //    - 王小羽 (registered directly on kjzx002120, Violin Grade 8 under tch_zhang -> official_only, auto-ingested + accrues ¥70 concession)
    const consRes = await app.inject({
      method: 'POST',
      url: '/official-sync/consolidate',
      payload: {
        cycle_id: '2025-summer',
        official_registrations: [
          {
            official_id: 'kjzx_2001',
            name_cn: '林小音',
            id_number: '310101201704126666',
            subject_id: 'piano',
            level: 5,
            teacher_id: 'tch_zhang',
          },
          {
            official_id: 'kjzx_2002',
            name_cn: '王小羽',
            id_number: '360101201508083333',
            subject_id: 'violin',
            level: 8,
            teacher_id: 'tch_zhang',
          },
        ],
      },
    });
    assert.equal(consRes.statusCode, 200);
    const report = consRes.json();
    assert.equal(report.total_unique_students, 3);
    assert.equal(report.helper_only_count, 1);
    assert.equal(report.matched_both_count, 1);
    assert.equal(report.official_only_count, 1);
    assert.equal(report.ingested_official_registration_ids.length, 1);

    // Verify that 王小羽 (official_only) automatically accrued Grade 8 concession (¥70 = 7000 fen) for tch_zhang
    const walletRes = await app.inject({
      method: 'GET',
      url: '/concessions/wallet?teacher_id=tch_zhang',
    });
    assert.equal(walletRes.json().summary.accrued_fen, 7000);

    await app.close();
  });

  it('Value-added checkout order bumps (AI ID photo + Mock video review) & multi-year historical student upgrade radar', async () => {
    const app = buildApp();

    // 1. Fetch Value-Added Catalog
    const catRes = await app.inject({
      method: 'GET',
      url: '/value-added/catalog',
    });
    assert.equal(catRes.statusCode, 200);
    assert.equal(catRes.json().items.length, 6);

    // 2. AI 2-Inch Standard Exam ID Photo Polish
    const photoRes = await app.inject({
      method: 'POST',
      url: '/value-added/id-photo-polish',
      payload: {
        name_cn: '陈小乐',
        id_number_or_last4: '440101201603159876',
        backdrop_color: 'blue',
      },
    });
    assert.equal(photoRes.statusCode, 200);
    assert.equal(photoRes.json().compliant, true);
    assert.equal(photoRes.json().official_filename, '440101201603159876_陈小乐.jpg');

    // 3. Configure custom Grade 6 rate card for Teacher Zhang (Fee ¥460 = 46000 fen, Concession ¥85 = 8500 fen)
    await app.inject({
      method: 'PUT',
      url: '/concessions/rate-cards',
      payload: {
        teacher_id: 'tch_zhang',
        level: 6,
        exam_fee_fen: 46000,
        concession_fen: 8500,
        note: '资深合伙 6级专属价',
      },
    });

    // 4. Create student + Grade 6 registration and pay with Order Bumps:
    //    - ai_id_photo (+¥1.90 = 190 fen, teacher share ¥0, platform profit 180 fen)
    //    - ai_video_review (+¥9.90 = 990 fen, teacher share ¥0, platform profit 990 fen)
    //    - mock_video_review (+¥49.90 = 4990 fen, teacher share +¥29.90 = 2990 fen, platform profit 2000 fen)
    //    Expected Total Paid: 46000 + 190 + 990 + 4990 = 52170 fen (¥521.70)
    //    Expected Teacher Concession when locked: 8500 + 2990 = 11490 fen (¥114.90)
    const lrn = await app.inject({
      method: 'POST',
      url: '/learners',
      payload: {
        name_cn: '周星辰',
        gender: '男',
        dob: '2016-09-01',
        id_type: '身份证',
        id_number: '360101201609017788',
        guardian_phone: '13900139000',
      },
    });
    const reg = await app.inject({
      method: 'POST',
      url: '/registrations',
      payload: {
        learner_id: lrn.json().id,
        cycle_id: '2025-summer',
        subject_id: 'piano',
        level: 6,
      },
    });
    const regId = reg.json().id;

    const payRes = await app.inject({
      method: 'POST',
      url: '/payments/checkout',
      payload: {
        registration_id: regId,
        teacher_id: 'tch_zhang',
        addon_ids: ['ai_id_photo', 'ai_video_review', 'mock_video_review'],
      },
    });
    assert.equal(payRes.statusCode, 201);
    assert.equal(payRes.json().order.amount_fen, 52170);
    assert.equal(payRes.json().order.amount_yuan, '¥521.70');
    assert.equal(payRes.json().addon_breakdown.addons_fee_fen, 6170);
    assert.equal(payRes.json().addon_breakdown.addons_teacher_bonus_fen, 2990);
    assert.equal(payRes.json().addon_breakdown.platform_net_addon_profit_fen, 3170);

    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'submitted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/registrations/${regId}/status`,
      payload: { to_status: 'locked' },
    });

    const walletRes = await app.inject({
      method: 'GET',
      url: '/concessions/wallet?teacher_id=tch_zhang',
    });
    assert.equal(walletRes.json().summary.accrued_fen, 11490);
    assert.equal(walletRes.json().summary.accrued_yuan, '¥114.90');

    // 5. Evaluate Multi-Year Historical Student Upgrade Radar:
    //    - 周星辰 (already registered in 2025-summer -> excluded from radar)
    //    - 许小贝 (passed Piano Grade 5 in 2024-summer under tch_zhang, not yet registered in 2025-summer -> recommended Grade 6 at ¥460 fee / ¥85 concession!)
    const radarRes = await app.inject({
      method: 'POST',
      url: '/value-added/upgrade-radar',
      payload: {
        target_cycle_id: '2025-summer',
        historical_records: [
          {
            name_cn: '周星辰',
            id_last4: '7788',
            guardian_phone: '13900139000',
            subject_id: 'piano',
            level: 5,
            cycle_id: '2024-summer',
            teacher_id: 'tch_zhang',
          },
          {
            name_cn: '许小贝',
            id_last4: '5544',
            guardian_phone: '13612345544',
            subject_id: 'piano',
            level: 5,
            cycle_id: '2024-summer',
            teacher_id: 'tch_zhang',
          },
        ],
      },
    });
    assert.equal(radarRes.statusCode, 200);
    const radar = radarRes.json();
    assert.equal(radar.total_candidates, 1);
    assert.equal(radar.candidates[0].name_cn, '许小贝');
    assert.equal(radar.candidates[0].last_level, 5);
    assert.equal(radar.candidates[0].recommended_level, 6);
    assert.equal(radar.candidates[0].expected_exam_fee_yuan, '¥460.00');
    assert.equal(radar.candidates[0].expected_concession_yuan, '¥85.00');
    assert.ok(radar.candidates[0].outreach_wechat_copy.includes('钢琴 6级'));

    await app.close();
  });

  it('Automated 初审 (compliance, person ID, song match, completeness) & AI 5D 复审 (timestamped issues + 50/50 reference videos)', async () => {
    const app = await buildApp();

    // 1. Run batch Automated 初审 on season 20245 (limit 3, without network media probe for fast test)
    const chushenRes = await app.inject({
      method: 'POST',
      url: '/official-sync/video-chushen-check',
      payload: {
        season_code: 20245,
        limit: 3,
        probe_media: false,
      },
    });
    assert.equal(chushenRes.statusCode, 200);
    const chushenBody = chushenRes.json();
    assert.ok(chushenBody.checked_count >= 1);
    const firstItem = chushenBody.items[0];
    assert.ok(['AUTO_PASS', 'NEEDS_HUMAN_CHECK', 'AUTO_REJECT'].includes(firstItem.verdict));
    assert.equal(firstItem.checks.length, 5);

    // 2. Run 5D AI Examiner Review on that exam_id
    const aiReviewRes = await app.inject({
      method: 'POST',
      url: '/official-sync/video-ai-5d-review',
      payload: {
        exam_id: firstItem.exam_id,
      },
    });
    assert.equal(aiReviewRes.statusCode, 200);
    const aiBody = aiReviewRes.json();
    assert.equal(aiBody.exam_id, firstItem.exam_id);
    assert.ok(typeof aiBody.score_total_50 === 'number');
    assert.ok(aiBody.dimensions_5d.yinzhun_pitch);
    assert.ok(Array.isArray(aiBody.timeline_issues));
    assert.ok(aiBody.timeline_issues.length >= 3);
    assert.ok(Array.isArray(aiBody.gold_reference_videos));

    await app.close();
  });
});

