/**
 * WeChat Service Account (服务号) & WeCom (企业微信) H5 Web Application.
 *
 * Served at `GET /app` (`https://mea.xgar.com.cn/app`) with three role/task tabs
 * matching the WeChat Service Account bottom menu:
 * - `?tab=parent`  : 我要报名 (Parent learner creation & registration submission)
 * - `?tab=archive` : 考级档案 (Exam results & certificate vault)
 * - `?tab=console` : 老师/机构工作台 (1-click Confirm & Lock + Template v2.1 Excel CSV export)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildServiceAccountMenuConfig } from '@musicexamaid/shared';

const WEB_APP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>考级助手 · MusicExamAid</title>
  <style>
    :root {
      --bg: #f5f7fa;
      --card: #ffffff;
      --primary: #07c160;
      --primary-dark: #06ad56;
      --wecom: #2b7bd6;
      --warn: #fa9d3b;
      --danger: #fa5151;
      --text: #191919;
      --muted: #6b7280;
      --border: #e5e7eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
      background: var(--bg);
      color: var(--text);
      padding-bottom: 72px;
    }
    header {
      background: linear-gradient(135deg, #07c160 0%, #059669 100%);
      color: #fff;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header h1 { margin: 0; font-size: 18px; font-weight: 600; }
    header span { font-size: 12px; opacity: 0.9; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 99px; }
    .container { max-width: 820px; margin: 16px auto; padding: 0 14px; }
    .card {
      background: var(--card);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      border: 1px solid var(--border);
    }
    .card h2 { margin: 0 0 12px; font-size: 16px; display: flex; justify-content: space-between; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
    input, select {
      width: 100%;
      padding: 9px 11px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      background: #fff;
    }
    button {
      border: none;
      border-radius: 8px;
      padding: 9px 14px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-dark); }
    .btn-wecom { background: var(--wecom); color: #fff; }
    .btn-warn { background: var(--warn); color: #fff; }
    .btn-sm { padding: 6px 10px; font-size: 12px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 99px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge-draft { background: #f3f4f6; color: #374151; }
    .badge-submitted { background: #dbeafe; color: #1d4ed8; }
    .badge-needs_change { background: #fef3c7; color: #b45309; }
    .badge-confirmed { background: #d1fae5; color: #047857; }
    .badge-locked { background: #065f46; color: #fff; }
    .item-row {
      border-top: 1px solid var(--border);
      padding: 12px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .item-row:first-of-type { border-top: none; }
    .bottom-nav {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #fff;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-around;
      padding: 8px 0;
      z-index: 20;
    }
    .nav-btn {
      background: none;
      color: var(--muted);
      font-size: 13px;
      padding: 6px 16px;
    }
    .nav-btn.active { color: var(--primary); font-weight: 600; }
    .hidden { display: none; }
    .toast {
      position: fixed;
      top: 16px; right: 16px;
      background: #1f2937; color: #fff;
      padding: 10px 16px; border-radius: 8px;
      font-size: 13px; z-index: 50;
    }
  </style>
</head>
<body>
  <header>
    <h1>🎵 考级助手 · 服务号与企微工作台</h1>
    <span>mea.xgar.com.cn</span>
  </header>

  <div id="toast" class="toast hidden"></div>

  <div class="container">
    <!-- TAB 1: PARENT -->
    <section id="tab-parent">
      <div class="card">
        <h2>1. 新增学员档案 <small style="font-size:12px;color:var(--muted)">身份证AES-256-GCM加密存储</small></h2>
        <div class="grid">
          <div><label>学员姓名</label><input id="l-name" placeholder="例如：张小琴" /></div>
          <div><label>性别</label><select id="l-gender"><option value="女">女</option><option value="男">男</option></select></div>
          <div><label>出生日期</label><input id="l-dob" type="date" value="2016-05-01" /></div>
          <div><label>证件类型</label><input id="l-idtype" value="身份证" /></div>
          <div><label>证件号码</label><input id="l-idnum" placeholder="18位身份证号" /></div>
          <div><label>家长手机</label><input id="l-phone" placeholder="11位手机号" /></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn-primary" onclick="createLearner()">保存学员档案</button>
        </div>
      </div>

      <div class="card">
        <h2>2. 新建考级报名</h2>
        <div class="grid">
          <div><label>选择学员</label><select id="r-learner"></select></div>
          <div><label>考期</label><select id="r-cycle"><option value="2025-summer">2025年暑期考期</option><option value="2025-fall">2025年秋季考期</option></select></div>
          <div><label>报考专业</label>
            <select id="r-subject">
              <option value="piano">钢琴</option>
              <option value="violin">小提琴</option>
              <option value="guzheng">古筝</option>
              <option value="music_theory">音乐基础知识</option>
            </select>
          </div>
          <div><label>报考级别</label><input id="r-level" type="number" min="1" max="10" value="5" /></div>
          <div><label>曲目1</label><input id="r-rep1" placeholder="例如：音阶与琶音" /></div>
          <div><label>曲目2</label><input id="r-rep2" placeholder="例如：车尔尼练习曲" /></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn-primary" onclick="createAndSubmitRegistration()">创建并提交老师审核</button>
        </div>
      </div>

      <div class="card">
        <h2>我的报名记录</h2>
        <div id="parent-reg-list">加载中...</div>
      </div>
    </section>

    <!-- TAB 2: ARCHIVE -->
    <section id="tab-archive" class="hidden">
      <div class="card">
        <h2>新增考级档案（证书/成绩保存）</h2>
        <div class="grid">
          <div><label>选择学员</label><select id="a-learner"></select></div>
          <div><label>专业</label><select id="a-subject"><option value="piano">钢琴</option><option value="music_theory">音乐基础知识</option></select></div>
          <div><label>级别</label><input id="a-level" type="number" value="4" /></div>
          <div><label>成绩结果</label><input id="a-result" value="优秀" /></div>
          <div><label>证书编号</label><input id="a-cert" placeholder="选填：国音证书编号" /></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn-primary" onclick="createArchive()">存入考级档案</button>
        </div>
      </div>
      <div class="card">
        <h2>已存考级档案</h2>
        <div id="archive-list">加载中...</div>
      </div>
    </section>

    <!-- TAB 3: TEACHER & ADMIN CONSOLE -->
    <section id="tab-console" class="hidden">
      <div class="card">
        <h2>
          <span>老师审核与机构汇总台</span>
          <button class="btn-wecom btn-sm" onclick="exportAllLocked()">📥 一键导出已锁定报名表 (Template v2.1 CSV)</button>
        </h2>
        <p style="font-size:13px;color:var(--muted);margin-top:0">
          支持「一键确认并锁定」（自动生成加密快照并推送企业微信/服务号通知）。
        </p>
        <div id="console-reg-list">加载中...</div>
      </div>
    </section>
  </div>

  <nav class="bottom-nav">
    <button id="nav-parent" class="nav-btn active" onclick="switchTab('parent')">📝 我要报名</button>
    <button id="nav-archive" class="nav-btn" onclick="switchTab('archive')">🏅 考级档案</button>
    <button id="nav-console" class="nav-btn" onclick="switchTab('console')">💼 老师/机构工作台</button>
  </nav>

  <script>
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2600);
    }

    function switchTab(tab) {
      ['parent', 'archive', 'console'].forEach(t => {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
        document.getElementById('nav-' + t).classList.toggle('active', t === tab);
      });
      refreshData();
    }

    async function refreshData() {
      const [lRes, rRes, aRes] = await Promise.all([
        fetch('/learners').then(r => r.json()),
        fetch('/registrations').then(r => r.json()),
        fetch('/archives').then(r => r.json())
      ]);

      const learnerOpts = (lRes.items || []).map(l =>
        '<option value="' + l.id + '">' + l.name_cn + ' (尾号' + l.id_last4 + ')</option>'
      ).join('') || '<option value="">请先创建学员</option>';
      document.getElementById('r-learner').innerHTML = learnerOpts;
      document.getElementById('a-learner').innerHTML = learnerOpts;

      const regs = rRes.items || [];
      document.getElementById('parent-reg-list').innerHTML = regs.length === 0
        ? '<p style="color:var(--muted);font-size:13px">暂无报名记录</p>'
        : regs.map(r => (
          '<div class="item-row">' +
            '<div><strong>' + r.learner_name_cn + '</strong> · ' + r.subject_name + ' ' + r.level + '级 (' + r.cycle_id + ')' +
            (r.teacher_notes ? '<div style="font-size:12px;color:#b45309">老师备注：' + r.teacher_notes + '</div>' : '') +
            '</div>' +
            '<div><span class="badge badge-' + r.status + '">' + r.status + '</span> ' +
            ((r.status === 'draft' || r.status === 'needs_change')
              ? '<button class="btn-primary btn-sm" onclick="transitionReg(\\'' + r.id + '\\', \\'submitted\\')">提交审核</button>'
              : '') +
            '</div>' +
          '</div>'
        )).join('');

      document.getElementById('console-reg-list').innerHTML = regs.length === 0
        ? '<p style="color:var(--muted);font-size:13px">暂无待处理报名</p>'
        : regs.map(r => (
          '<div class="item-row">' +
            '<div><strong>' + r.learner_name_cn + '</strong> · ' + r.subject_name + ' ' + r.level + '级 · <small>' + r.id + '</small></div>' +
            '<div style="display:flex;gap:6px;align-items:center">' +
              '<span class="badge badge-' + r.status + '">' + r.status + '</span>' +
              (r.status === 'submitted' || r.status === 'confirmed'
                ? '<button class="btn-primary btn-sm" onclick="transitionReg(\\'' + r.id + '\\', \\'locked\\')">⚡ 一键确认并锁定</button>' +
                  '<button class="btn-warn btn-sm" onclick="transitionReg(\\'' + r.id + '\\', \\'needs_change\\')">退回修改</button>'
                : '') +
            '</div>' +
          '</div>'
        )).join('');

      const arcs = aRes.items || [];
      document.getElementById('archive-list').innerHTML = arcs.length === 0
        ? '<p style="color:var(--muted);font-size:13px">暂无考级档案</p>'
        : arcs.map(a => (
          '<div class="item-row">' +
            '<div><strong>' + a.learner_name_cn + '</strong> · ' + a.subject_name + ' ' + a.level + '级</div>' +
            '<div><span class="badge badge-confirmed">' + a.result + '</span> <small>' + (a.certificate_no || '') + '</small></div>' +
          '</div>'
        )).join('');
    }

    async function createLearner() {
      const payload = {
        name_cn: document.getElementById('l-name').value.trim(),
        gender: document.getElementById('l-gender').value,
        dob: document.getElementById('l-dob').value,
        id_type: document.getElementById('l-idtype').value,
        id_number: document.getElementById('l-idnum').value.trim(),
        guardian_phone: document.getElementById('l-phone').value.trim(),
      };
      const res = await fetch('/learners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return showToast('请完整填写学员姓名、证件号与手机号');
      showToast('学员档案已加密保存');
      refreshData();
    }

    async function createAndSubmitRegistration() {
      const learner_id = document.getElementById('r-learner').value;
      if (!learner_id) return showToast('请先创建并选择学员');
      const createRes = await fetch('/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id,
          cycle_id: document.getElementById('r-cycle').value,
          subject_id: document.getElementById('r-subject').value,
          level: Number(document.getElementById('r-level').value),
          repertoire: [
            document.getElementById('r-rep1').value.trim(),
            document.getElementById('r-rep2').value.trim(),
          ].filter(Boolean),
        }),
      });
      if (!createRes.ok) return showToast('创建报名失败');
      const reg = await createRes.json();
      await fetch('/registrations/' + reg.id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_status: 'submitted' }),
      });
      showToast('已提交老师审核（企业微信已通知老师）');
      refreshData();
    }

    async function transitionReg(id, toStatus) {
      const teacher_notes = toStatus === 'needs_change' ? '请核对曲目或重新上传清晰证件照' : '审核通过并锁定';
      const res = await fetch('/registrations/' + id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_status: toStatus, teacher_notes }),
      });
      if (!res.ok) return showToast('状态流转失败');
      showToast('状态已更新为 ' + toStatus);
      refreshData();
    }

    async function createArchive() {
      const learner_id = document.getElementById('a-learner').value;
      if (!learner_id) return showToast('请先选择学员');
      const res = await fetch('/archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id,
          subject_id: document.getElementById('a-subject').value,
          level: Number(document.getElementById('a-level').value),
          result: document.getElementById('a-result').value,
          certificate_no: document.getElementById('a-cert').value,
        }),
      });
      if (res.ok) {
        showToast('考级档案已保存');
        refreshData();
      }
    }

    async function exportAllLocked() {
      const rRes = await fetch('/registrations').then(r => r.json());
      const lockedIds = (rRes.items || []).filter(r => r.status === 'locked').map(r => r.id);
      if (lockedIds.length === 0) return showToast('当前没有已锁定 (locked) 的报名记录可导出');
      const expRes = await fetch('/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycle_id: '2025-summer',
          batch_type: 'super',
          registration_ids: lockedIds,
        }),
      });
      if (!expRes.ok) return showToast('导出任务创建失败');
      const job = await expRes.json();
      window.location.href = job.download_csv_url;
    }

    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') || 'parent';
    switchTab(['parent', 'archive', 'console'].includes(initialTab) ? initialTab : 'parent');
  </script>
</body>
</html>`;

export async function webAppRoutes(app: FastifyInstance): Promise<void> {
  app.get('/app', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html; charset=utf-8').code(200).send(WEB_APP_HTML);
  });

  app.get(
    '/webhooks/wechat-mp/menu-config',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const baseUrl = process.env.PUBLIC_BASE_URL || 'https://mea.xgar.com.cn';
      return reply.code(200).send(buildServiceAccountMenuConfig(baseUrl));
    },
  );
}
