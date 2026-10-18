/**
 * WeChat Service Account (服务号) & WeCom (企业微信) Production H5 Web Application (v2.3).
 *
 * Supports strict Role & Data Isolation via URL tokens / WeChat OpenID binding:
 * - Admin Master View  : `/app?role=admin` (Full 4 tabs + 200-teacher invite generator + concession audit)
 * - Teacher Locked View: `/app?invite=t_inv_999_testdemo` or `/app?invite=t_inv_068_acb20f36`
 *                        (Hides Admin tab, locks to single teacher's students/radar/wallet, 1-click WeChat bind & parent link share)
 * - Parent Locked View : `/app?ref=ref_999` or `/app?ref=ref_068`
 *                        (Hides Teacher & Admin tabs, hides all concession figures, locks registration & lookup to referring teacher)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildServiceAccountMenuConfig } from '@musicexamaid/shared';

const WEB_APP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>考级助手 · 服务号与企微工作台 (MusicExamAid v2.3)</title>
  <style>
    :root {
      --bg: #f1f5f9;
      --card: #ffffff;
      --primary: #07c160;
      --primary-dark: #059669;
      --wecom: #2563eb;
      --purple: #7c3aed;
      --warn: #d97706;
      --danger: #dc2626;
      --text: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      padding-bottom: 84px;
    }
    header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #fff;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 30;
      box-shadow: 0 2px 10px rgba(0,0,0,0.12);
      flex-wrap: wrap;
      gap: 10px;
    }
    header h1 { margin: 0; font-size: 16.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .role-switcher-bar {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 8px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .role-chip {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 99px;
      background: rgba(255,255,255,0.08);
      color: #e2e8f0;
      text-decoration: none;
      font-weight: 600;
      border: 1px solid rgba(255,255,255,0.14);
      cursor: pointer;
    }
    .role-chip:hover { background: rgba(255,255,255,0.18); }
    .role-chip.active { background: #07c160; color: #fff; border-color: #4ade80; }
    .header-badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pill {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 99px;
      background: rgba(255,255,255,0.12);
      color: #e2e8f0;
      font-weight: 500;
    }
    .pill-green { background: rgba(7,193,96,0.22); color: #4ade80; border: 1px solid rgba(74,222,128,0.4); }
    .container { max-width: 1060px; margin: 16px auto; padding: 0 14px; }
    .card {
      background: var(--card);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(15,23,42,0.06);
      border: 1px solid var(--border);
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 700;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .sub { font-size: 13px; color: var(--muted); margin: -4px 0 12px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .stat-box {
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
    }
    .stat-label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .stat-val { font-size: 22px; font-weight: 800; margin-top: 4px; color: var(--text); }
    label { display: block; font-size: 12.5px; color: var(--muted); font-weight: 600; margin-bottom: 4px; }
    input, select {
      width: 100%;
      padding: 9px 11px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
    }
    input[readonly] { background: #f1f5f9; color: #334155; font-weight: 600; }
    input[type="checkbox"] { width: auto; transform: scale(1.15); margin-right: 6px; }
    button {
      border: none;
      border-radius: 8px;
      padding: 9px 14px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.92; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-wecom { background: var(--wecom); color: #fff; }
    .btn-purple { background: var(--purple); color: #fff; }
    .btn-warn { background: var(--warn); color: #fff; }
    .btn-outline { background: #f8fafc; color: var(--text); border: 1px solid var(--border); }
    .btn-sm { padding: 6px 10px; font-size: 12px; border-radius: 6px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 99px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .badge-draft { background: #f1f5f9; color: #475569; }
    .badge-submitted { background: #dbeafe; color: #1d4ed8; }
    .badge-needs_change { background: #fef3c7; color: #b45309; }
    .badge-confirmed { background: #d1fae5; color: #047857; }
    .badge-locked { background: #065f46; color: #fff; }
    .badge-upgrade { background: #f3e8ff; color: #6d28d9; }
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
    .addon-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 8px;
      background: #f8fafc;
      cursor: pointer;
    }
    .addon-row:hover { border-color: var(--primary); background: #f0fdf4; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
    th { background: #f8fafc; color: var(--muted); font-weight: 600; font-size: 12px; }
    .bottom-nav {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: rgba(255,255,255,0.96);
      backdrop-filter: blur(10px);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-around;
      padding: 8px 0;
      z-index: 40;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.04);
    }
    .nav-btn {
      background: none;
      color: var(--muted);
      font-size: 13px;
      padding: 6px 14px;
      border-radius: 8px;
    }
    .nav-btn.active {
      color: var(--primary-dark);
      background: #ecfdf5;
      font-weight: 700;
    }
    .hidden { display: none !important; }
    .toast {
      position: fixed;
      top: 64px; right: 16px;
      background: #0f172a; color: #fff;
      padding: 11px 16px; border-radius: 10px;
      font-size: 13px; z-index: 60;
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
      max-width: 420px;
    }
  </style>
</head>
<body>
  <header>
    <h1>🎵 考级助手 · 服务号与企微工作台</h1>
    <div class="header-badges">
      <span id="role-identity-pill" class="pill pill-green">👑 考级办管理员总控视角</span>
      <span class="pill">mea.xgar.com.cn</span>
    </div>
  </header>

  <!-- Quick Role Sandbox Bar so Admin/Tester can switch between Admin, Teacher & Parent accounts in 1 click -->
  <div class="role-switcher-bar">
    <div><strong>🧪 视角一键切换：</strong></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <a class="role-chip" id="chip-mom" href="/app?tab=mom" style="background:#fef3c7;border-color:#f59e0b;color:#92400e;font-weight:700;font-size:13.5px">👵 0. 妈妈/日常大字极简台 (只留3个大按钮)</a>
      <a class="role-chip" id="chip-admin" href="/app?role=admin&tab=console">👑 1. 考级办管理员 (全权限)</a>
      <a class="role-chip" id="chip-t999" href="/app?invite=t_inv_999_testdemo&tab=teacher">👩‍🏫 2. 测试张老师专席 (999琴行隔离)</a>
      <a class="role-chip" id="chip-t068" href="/app?invite=t_inv_068_acb20f36&tab=teacher">👩‍🏫 3. 实盘黄蓝老师专席 (068隔离)</a>
      <a class="role-chip" id="chip-p999" href="/app?ref=ref_999&tab=parent">👨‍👩‍👧 4. 家长扫码报名视角 (锁定999测试张老师)</a>
      <a class="role-chip" id="chip-p068" href="/app?ref=ref_068&tab=parent">👨‍👩‍👧 5. 家长扫码报名视角 (锁定068黄蓝老师)</a>
    </div>
  </div>

  <div id="toast" class="toast hidden"></div>

  <div class="container">
    <!-- =================================================================== -->
    <!-- TAB 1: PARENT (老生 10秒一键续报 + 增值服务包 + 微信支付)             -->
    <!-- =================================================================== -->
    <section id="tab-parent">
      <div id="parent-ref-banner" class="card hidden" style="background:linear-gradient(90deg,#eff6ff 0%,#f0fdf4 100%);border-color:#93c5fd;padding:12px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="font-size:13.5px">
            🏫 <strong>当前专属报名通道：</strong> 您正在通过 <strong id="parent-ref-teacher-name" style="color:var(--wecom)">—</strong> 的专属链接报名，系统已自动为您锁定指导老师与往年档案库。
          </div>
          <span class="badge badge-confirmed">🔒 机构专属通道已加密锁定</span>
        </div>
      </div>

      <div class="card" style="border: 2px solid #86efac; background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)">
        <h2>
          <span>⚡ 老生 10 秒免填表续报（检索本机构历年真实考生档案）</span>
          <span class="badge badge-upgrade">自动带入往期级别 +1 直升</span>
        </h2>
        <p class="sub">输入考生姓名或家长手机号后 4 位，一键调出往年档案与证件照免填表报名：</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <input id="quick-search-input" style="flex:1;min-width:220px" placeholder="输入考生姓名 / 拼音 / 手机号后4位" value="测试陈小乐" onkeydown="if(event.key==='Enter')searchHistoricalStudent('parent')" />
          <button class="btn-primary" onclick="searchHistoricalStudent('parent')">🔍 检索历年档案</button>
          <button class="btn-outline btn-sm" onclick="document.getElementById('quick-search-input').value='测试';searchHistoricalStudent('parent')">试搜：测试学员(999琴行)</button>
          <button class="btn-outline btn-sm" onclick="document.getElementById('quick-search-input').value='李仕泓';searchHistoricalStudent('parent')">试搜：李仕泓(黄蓝老师)</button>
          <button class="btn-outline btn-sm" onclick="document.getElementById('quick-search-input').value='樊澍雨';searchHistoricalStudent('parent')">试搜：樊澍雨</button>
        </div>
        <div id="parent-lookup-results"></div>
      </div>

      <div class="card">
        <h2>1. 考生基本信息 <small style="font-size:12px;color:var(--muted)">身份证号采用国密级 AES-256-GCM 加密存储于上海境内节点</small></h2>
        <div class="grid">
          <div><label>学员姓名</label><input id="l-name" placeholder="例如：测试陈小乐" value="测试陈小乐" /></div>
          <div><label>性别</label><select id="l-gender"><option value="女">女</option><option value="男">男</option></select></div>
          <div><label>出生日期</label><input id="l-dob" type="date" value="2016-05-12" /></div>
          <div><label>证件类型</label><input id="l-idtype" value="身份证" /></div>
          <div><label>证件号码 (18位)</label><input id="l-idnum" placeholder="360402201605129901" value="360402201605129901" /></div>
          <div><label>家长手机</label><input id="l-phone" placeholder="11位手机号" value="13800139901" /></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn-primary" onclick="createLearner()">💾 保存/更新学员档案</button>
          <button class="btn-purple btn-sm" onclick="runAiIdPhotoPolish()">✨ AI 二寸标准照合规检测与一键换白底</button>
          <span id="photo-polish-status" style="font-size:12px;color:var(--muted)"></span>
        </div>
      </div>

      <div class="card">
        <h2>
          <span>2. 报考科目、常年固定级别费与增值服务包</span>
          <span style="font-size:12px;color:var(--primary-dark)">中国音乐学院官方常年统一收费标准 (1级¥200 .. 10级¥510, 演奏级¥620)</span>
        </h2>
        <div class="grid">
          <div><label>选择学员</label><select id="r-learner"></select></div>
          <div><label>报考考期</label>
            <select id="r-cycle">
              <option value="2025-summer">2026年暑期考期 (2026暑假)</option>
              <option value="2025-winter">2026年寒假考期 (2026寒假)</option>
              <option value="2025-fall">2025年秋季考期</option>
            </select>
          </div>
          <div><label>报考专业 (45个国音官方专业)</label>
            <select id="r-subject">
              <option value="piano">钢琴</option>
              <option value="guzheng">古筝</option>
              <option value="violin">小提琴</option>
              <option value="music_theory">音乐基础知识 (音基)</option>
              <option value="guitar">民谣吉他</option>
              <option value="erhu">二胡</option>
              <option value="pipa">琵琶</option>
              <option value="flute">长笛</option>
              <option value="saxophone">萨克斯</option>
              <option value="vocal">声乐</option>
            </select>
          </div>
          <div><label>报考级别 (1–10级 / 11=演奏级)</label>
            <select id="r-level" onchange="recalcParentCheckout()">
              <option value="1">1级 (官方固定费 ¥200)</option>
              <option value="2">2级 (官方固定费 ¥240)</option>
              <option value="3">3级 (官方固定费 ¥280)</option>
              <option value="4">4级 (官方固定费 ¥320)</option>
              <option value="5">5级 (官方固定费 ¥360)</option>
              <option value="6" selected>6级 (官方固定费 ¥390)</option>
              <option value="7">7级 (官方固定费 ¥420)</option>
              <option value="8">8级 (官方固定费 ¥450)</option>
              <option value="9">9级 (官方固定费 ¥480)</option>
              <option value="10">10级 (官方固定费 ¥510)</option>
              <option value="11">11级·演奏级 (官方固定费 ¥620)</option>
            </select>
          </div>
          <div><label>指导老师 / 机构编码</label><input id="r-teacher" value="tch_zhang" placeholder="如：测试张老师" /></div>
          <div><label>考试曲目 (用逗号分隔)</label><input id="r-rep1" value="音阶与琶音, 练习曲, 奏鸣曲, 中外乐曲" /></div>
        </div>

        <!-- Automatic Missing Music Theory (音基) Joint-Registration Banner -->
        <div id="theory-joint-banner" style="margin-top:14px;padding:12px 14px;background:linear-gradient(90deg,#fffbeb 0%,#fef3c7 100%);border:1.5px solid #f59e0b;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="font-size:13px;color:#92400e">
            <strong>🔔 国音考级办档案核验提醒：</strong>系统检测到该生报考器乐级别较高，但名下尚无<strong>《音乐基础知识 (音基)》</strong>证书记录（全库共 2,439 名器乐考生待补考音基）。
            <div style="margin-top:4px;font-size:12px;color:#b45309">💡 勾选右侧「同季一键联报音基 1级 (官方费 ¥200)」，<strong>本考级办直接免费赠送价值 ¥98 的《音基全真冲刺题库 + 3套模考卷》！</strong></div>
          </div>
          <label style="background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #f59e0b;cursor:pointer;display:flex;align-items:center;gap:6px;margin:0;color:#92400e;font-weight:700">
            <input type="checkbox" id="cb-joint-theory" data-price="200" onchange="recalcParentCheckout()" style="width:auto" />
            <span>⚡ 同季联报《音乐基础知识 1级》(+¥200 · 赠题库)</span>
          </label>
        </div>

        <div style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">
            <label style="font-size:13.5px;color:var(--text);margin:0">🔒 <strong>本考级办在籍考生专享补贴包</strong>（仅限通过本办报名考生解锁 · 低于市面价 80%）：</label>
            <span class="badge badge-confirmed">🎁 在籍考生免费享：2020–2026 历年考级高清视频云档案永久保存 (非本办考生 ¥50/年)</span>
          </div>
          <div id="parent-addons-box">
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" value="ai_id_photo" data-price="1.9" data-market="35" checked onchange="recalcParentCheckout()" />
                <strong>✨ AI 考级标准二寸照一键换底精修</strong>
                <small style="color:var(--muted)">(自动抠图换标准白底 + 413×626px 合规裁剪 · <del>照相馆市面价 ¥35</del>)</small>
              </span>
              <span><span class="badge badge-upgrade" style="margin-right:6px">考生补贴价</span><strong style="color:var(--primary-dark)">+¥1.90</strong></span>
            </label>
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" value="ai_video_review" data-price="9.9" data-market="68" checked onchange="recalcParentCheckout()" />
                <strong>🤖 评点方案1：AI 国音考官五维模拟测评 + 九江同曲目百分位排名报告</strong>
                <small style="color:var(--muted)">(基于 1.64 万份国音考官真实五维打分大模型 · 秒出音准/节奏/音色/表现力/完整性得分 · <del>市面智能测评 ¥68</del>)</small>
              </span>
              <span><span class="badge badge-upgrade" style="margin-right:6px">AI补贴价</span><strong style="color:var(--primary-dark)">+¥9.90</strong></span>
            </label>
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" value="mock_video_review" data-price="49.9" data-market="150" onchange="recalcParentCheckout()" />
                <strong>👨‍🏫 评点方案2：真人名师 1对1 考前视频精评指导报告</strong>
                <small style="color:var(--muted)">(资深考级名师逐句语音/文字批注 + 考前冲刺纠错单 · 含指导老师劳务分润 ¥29.90 · <del>市面名师预审 ¥150</del>)</small>
              </span>
              <span><span class="badge badge-paid" style="margin-right:6px">名师精评</span><strong style="color:var(--primary-dark)">+¥49.90</strong></span>
            </label>
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" id="cb-addon-theory-pack" value="music_theory_pack" data-price="19.9" data-market="98" onchange="recalcParentCheckout()" />
                <strong>🎧 中国音乐学院《音乐基础知识/音基》全真冲刺题库</strong>
                <small style="color:var(--muted)">(配套级别视唱练耳闯关 + 3套全真模考卷 · <del>外部独立购买 ¥98</del>)</small>
              </span>
              <span><span class="badge badge-upgrade" style="margin-right:6px">考生补贴价</span><strong style="color:var(--primary-dark)" id="price-label-theory-pack">+¥19.90</strong></span>
            </label>
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" value="household_ocr_vip" data-price="2.9" data-market="25" onchange="recalcParentCheckout()" />
                <strong>📸 户口本/身份证生僻字核验 + 制证信息错漏免费重办保障</strong>
                <small style="color:var(--muted)">(<del>独立服务费 ¥25</del>)</small>
              </span>
              <span><span class="badge badge-upgrade" style="margin-right:6px">考生补贴价</span><strong style="color:var(--primary-dark)">+¥2.90</strong></span>
            </label>
            <label class="addon-row">
              <span>
                <input type="checkbox" class="p-addon-cb" value="growth_archive_frame" data-price="29.9" data-market="88" onchange="recalcParentCheckout()" />
                <strong>🏅 定制胡桃木国音考级证书荣誉相框 (顺丰包邮) + 星光成长档案卡</strong>
                <small style="color:var(--muted)">(<del>琴行零售价 ¥88</del>)</small>
              </span>
              <span><span class="badge badge-upgrade" style="margin-right:6px">考生补贴价</span><strong style="color:var(--primary-dark)">+¥29.90</strong></span>
            </label>
          </div>
        </div>

        <div style="margin-top:14px;padding:14px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:12.5px;color:#166534" id="checkout-summary-text">6级官方固定报名费 ¥390.00 + 在籍考生专享补贴包 ¥11.80（已为您立省 ¥223.20）</div>
            <div style="font-size:20px;font-weight:800;color:#14532d">微信支付应付总额：<span id="checkout-total-yuan">¥401.80</span></div>
          </div>
          <button class="btn-primary" style="padding:11px 20px;font-size:15px" onclick="createAndSubmitRegistration()">💳 立即提交报名并微信支付</button>
        </div>
      </div>

      <div class="card">
        <h2>我的本期报名与缴费记录</h2>
        <div id="parent-reg-list">加载中...</div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 2: ARCHIVE (2020-2026 31,939笔真实考级档案、证书与演奏视频库)    -->
    <!-- =================================================================== -->
    <section id="tab-archive" class="hidden">
      <div class="card">
        <h2>
          <span>🏅 2020–2026 历年考级星光档案库</span>
          <span class="badge badge-confirmed">支持本地 MinIO 视频加速回放与一键预缓存</span>
        </h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <input id="archive-search-input" style="flex:1;min-width:220px" placeholder="输入考生姓名 / 拼音 / 手机号查询历年全部考级记录" value="樊澍雨" onkeydown="if(event.key==='Enter')searchHistoricalStudent('archive')" />
          <button class="btn-wecom" onclick="searchHistoricalStudent('archive')">🔍 查询历年考级档案</button>
        </div>

        <!-- In-Page Local MinIO Video Player Drawer -->
        <div id="local-video-drawer" class="hidden" style="margin-bottom:14px;padding:14px;background:#0f172a;color:#fff;border-radius:12px;border:1px solid #334155">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div>
              <span class="badge badge-confirmed" id="local-video-cache-badge">🚀 本地 MinIO 穿透加速 (首次播放自动落盘上海服务器)</span>
              <strong id="local-video-title" style="margin-left:8px;font-size:14px">考级演奏视频回放</strong>
            </div>
            <div style="display:flex;gap:6px">
              <a id="local-video-raw-link" href="#" target="_blank" style="text-decoration:none"><button class="btn-outline btn-sm" style="background:#1e293b;color:#e2e8f0;border-color:#475569">🔗 原画直链</button></a>
              <button class="btn-outline btn-sm" style="background:#1e293b;color:#e2e8f0;border-color:#475569" onclick="closeLocalVideoPlayer()">✖ 关闭播放器</button>
            </div>
          </div>
          <video id="local-video-player" controls playsinline style="width:100%;max-height:420px;border-radius:8px;background:#000"></video>
        </div>

        <div id="archive-lookup-results">正在加载历年考级档案...</div>
      </div>

      <div class="card">
        <h2>手动补录其它院系历史考级证书</h2>
        <div class="grid">
          <div><label>选择学员</label><select id="a-learner"></select></div>
          <div><label>专业</label><select id="a-subject"><option value="piano">钢琴</option><option value="guzheng">古筝</option><option value="violin">小提琴</option><option value="music_theory">音乐基础知识</option></select></div>
          <div><label>级别</label><input id="a-level" type="number" value="4" /></div>
          <div><label>成绩结果</label><input id="a-result" value="通过" /></div>
          <div><label>证书编号</label><input id="a-cert" placeholder="选填：国音证书编号" /></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn-primary" onclick="createArchive()">存入考级档案</button>
        </div>
        <div id="archive-list" style="margin-top:12px"></div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 3: TEACHER WORKBENCH (老师微信绑定 + 专属家长推广链接 + 升班雷达) -->
    <!-- =================================================================== -->
    <section id="tab-teacher" class="hidden">
      <!-- Teacher WeChat Account Binding & Parent Referral Link Card -->
      <div class="card" style="background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);color:#fff;border:none">
        <h2 style="color:#fff">
          <span id="t-bind-header-title">🔗 合作老师微信号免密绑定 & 本琴行家长专属报名链接</span>
          <span id="t-bind-status-badge" class="badge" style="background:#fef3c7;color:#92400e">⏳ 待绑定微信号</span>
        </h2>
        <p style="font-size:13px;color:#c7d2fe;margin:0 0 12px">
          首次点击专属邀请链接并绑定微信号 (<code>wx_openid</code>) 后，后续从服务号菜单进入将自动识别您的机构身份，且严格隔离其它机构数据。
        </p>
        <div class="grid" style="align-items:end">
          <div>
            <label style="color:#c7d2fe">1. 绑定当前老师微信实名昵称：</label>
            <div style="display:flex;gap:8px">
              <input id="t-wx-nickname-input" placeholder="输入老师微信昵称 (如：张老师-小戈尔琴行)" value="张老师 (微信实名)" style="background:rgba(255,255,255,0.95)" />
              <button class="btn-primary" style="white-space:nowrap" onclick="bindCurrentTeacherWeChat(false)">🔗 一键绑定微信号</button>
              <button class="btn-outline btn-sm" style="white-space:nowrap" onclick="bindCurrentTeacherWeChat(true)">解绑重置</button>
            </div>
          </div>
          <div>
            <label style="color:#c7d2fe">2. 转发给本琴行家长的「专属免填表报名链接」：</label>
            <div style="display:flex;gap:8px">
              <input id="t-parent-ref-url" readonly value="https://mea.xgar.com.cn/app?ref=ref_999&tab=parent" style="background:rgba(255,255,255,0.9)" />
              <button class="btn-wecom" style="white-space:nowrap" onclick="copyParentReferralLink()">📲 复制发给家长群</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="border: 2px solid #c084fc">
        <h2>
          <span>👩‍🏫 合作老师专属工作台</span>
          <span id="t-isolation-badge" class="badge badge-upgrade">数据隔离保护中</span>
        </h2>
        <div id="teacher-selector-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
          <div style="flex:1;min-width:260px">
            <label>切换合作老师 / 报名点（仅考级办管理员可见，老师专属链接自动锁定）：</label>
            <select id="teacher-agent-select" onchange="loadTeacherRadarAndWallet()"></select>
          </div>
          <div>
            <label>&nbsp;</label>
            <button class="btn-purple" onclick="loadTeacherRadarAndWallet()">🔄 刷新本机构升班雷达</button>
          </div>
        </div>

        <div class="grid-4" style="margin-bottom:14px">
          <div class="stat-box">
            <div class="stat-label">🎯 本机构 2026 待升班老生</div>
            <div id="t-radar-count" class="stat-val" style="color:var(--purple)">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">💳 预计升班报名费总额</div>
            <div id="t-radar-fee" class="stat-val" style="color:var(--wecom)">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">💰 预计可获优待金/劳务费</div>
            <div id="t-radar-conc" class="stat-val" style="color:var(--primary-dark)">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">🏦 当前可提现优待金余额</div>
            <div id="t-wallet-avail" class="stat-val" style="color:var(--warn)">¥0.00</div>
          </div>
        </div>

        <h3 style="font-size:14px;margin:10px 0 8px">📡 本机构「2025已考但2026未续报」智能升班催报单（点击一键复制微信话术或代建单）：</h3>
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>考生姓名 / 家长电话</th>
                <th>2025 已通过级别</th>
                <th>2026 推荐直升</th>
                <th>固定报名费 / 老师优待金</th>
                <th>快捷操作</th>
              </tr>
            </thead>
            <tbody id="teacher-radar-tbody">
              <tr><td colspan="5">正在从 PostgreSQL 加载待升班考生...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>
          <span>💰 指导老师分润账本与一键申请提现</span>
          <button class="btn-primary btn-sm" onclick="requestTeacherWithdrawal()">💸 一键申请提现可结算余额</button>
        </h2>
        <div id="teacher-wallet-detail">加载中...</div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 4: ADMIN CONSOLE (考级办总控台：邀请函发放 + 官网同步 + 导出)    -->
    <!-- =================================================================== -->
    <section id="tab-console" class="hidden">
      <div class="card" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff">
        <h2 style="color:#fff">
          <span>🏛️ 江西小戈尔 · 中国音乐学院考级办 (<code>kjzx002120</code>) 实盘数据大盘</span>
          <span style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary btn-sm" onclick="openQrSyncModal()">📲 官网微信扫码同步 (kjzx002120)</button>
            <button class="btn-wecom btn-sm" onclick="exportAllLocked('zip')">📦 导出报名表+证件照ZIP包</button>
            <button class="btn-outline btn-sm" onclick="exportAllLocked('csv')">📥 仅导出Excel CSV</button>
          </span>
        </h2>
        <div class="grid-4" style="margin-top:10px">
          <div class="stat-box" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14)">
            <div class="stat-label" style="color:#94a3b8">👨‍🎓 历年考生档案总数</div>
            <div id="adm-stat-students" class="stat-val" style="color:#38bdf8">10,379 人</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14)">
            <div class="stat-label" style="color:#94a3b8">📝 2020–2026 历年报考总人次</div>
            <div id="adm-stat-exams" class="stat-val" style="color:#4ade80">31,942 笔</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14)">
            <div class="stat-label" style="color:#94a3b8">👩‍🏫 合作老师 / 机构数</div>
            <div id="adm-stat-agents" class="stat-val" style="color:#fbbf24">201 家</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14)">
            <div class="stat-label" style="color:#94a3b8">🎯 2026 待升班老生池 (¥56.6万)</div>
            <div id="adm-stat-radar" class="stat-val" style="color:#c084fc">1,623 人</div>
          </div>
        </div>

        <!-- QR Sync Drawer -->
        <div id="qr-sync-drawer" class="hidden" style="margin-top:14px;padding:14px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.2);border-radius:10px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div id="adm-qr-img" style="width:130px;height:130px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#0f172a;font-size:12px;text-align:center;padding:4px">正在获取二维码...</div>
          <div style="flex:1;min-width:220px;font-size:13px">
            <div style="margin-bottom:6px"><strong>考级办官网 (<code>kjzx002120.kj5.zgyyxykj.com/admins</code>) 实时扫码会话：</strong></div>
            <div>PHPSESSID: <code id="adm-qr-sess" style="color:#38bdf8">—</code> | Token: <code id="adm-qr-token" style="color:#fbbf24">—</code></div>
            <div style="margin-top:6px">状态: <span id="adm-qr-status" class="badge badge-submitted">等待管理员微信扫码...</span></div>
          </div>
        </div>
      </div>

      <!-- Partner Teacher Invite Link & WeChat Binding Management Table -->
      <div class="card" style="border:2px solid #38bdf8">
        <h2>
          <span>🔑 合作老师「微信绑定邀请函」与「家长专属报名码」发放台</span>
          <span class="badge badge-submitted">每个老师独立 Token · 首次点击自动绑定微信 OpenID</span>
        </h2>
        <p class="sub">您可以先用第 1 行 <strong>「【测试专席】小戈尔示范琴行 (测试张老师)」</strong> 测试完整闭环，再按需复制任意实盘老师的专属邀请函发至对方微信：</p>
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>编码 / 机构名称</th>
                <th>负责人 / 历年考次</th>
                <th>微信绑定状态 (OpenID)</th>
                <th>老师专属绑定链接 (发给老师)</th>
                <th>家长专属报名链接 (发给家长群)</th>
              </tr>
            </thead>
            <tbody id="adm-invite-tbody">
              <tr><td colspan="5">正在加载合作老师列表...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>本期新增报名单审核、一键锁定与老师优待金确认</h2>
        <div id="console-reg-list">加载中...</div>
      </div>

      <!-- Local MinIO Media Cache Center -->
      <div class="card" style="border:2px solid #16a34a">
        <h2>
          <span>🗄️ 上海服务器 (<code>ubtxiaomi MinIO S3</code>) 考级视频与证件照本地镜像中心</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-primary btn-sm" onclick="prebufferBatchMedia('20264', 6)">📥 批量预缓存 2026春季 考级视频 (6条)</button>
            <button class="btn-outline btn-sm" onclick="loadMediaCacheStats()">🔄 刷新缓存统计</button>
          </span>
        </h2>
        <p class="sub">
          采用「<strong>穿透缓存 (Read-Through Proxy) + 按需批量预热 (Pre-Buffer)</strong>」双引擎：任何老师或家长在 H5 点击播放考级视频或查看二寸证件照时，上海服务器会自动从官网阿里云 OSS 拉取并永久存入本地 <code>MinIO (100.64.0.4:9010/musicexamaid-dev/kjzx_cache/)</code>，支持 HTTP Range <code>206 Partial Content</code> 拖动进度条秒开，且不会瞬间撑爆 316GB 磁盘空间。
        </p>
        <div class="grid-4" id="adm-media-cache-stats">
          <div class="stat-box">
            <div class="stat-label">🎬 历史视频库总量</div>
            <div class="stat-val" id="mc-total-videos">66,214 条</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">⚡ 已缓存在本地 MinIO 视频</div>
            <div class="stat-val" style="color:var(--primary-dark)" id="mc-cached-videos">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">🖼️ 已缓存在本地二寸证件照</div>
            <div class="stat-val" style="color:var(--wecom)" id="mc-cached-photos">—</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">💾 本地 MinIO 已占用空间</div>
            <div class="stat-val" style="color:var(--purple)" id="mc-cached-mb">— MB</div>
          </div>
        </div>
      </div>

      <div class="card" style="border:2px solid #f59e0b">
        <h2>
          <span>🕵️ 合作机构流失归因诊断与「在籍考生补贴包」锁客雷达</span>
          <span class="badge badge-needs_change" id="adm-theory-gap-badge">待补考《音基》老生池：2,439 人 (潜在报名费 ¥58.5万)</span>
        </h2>
        <p class="sub">
          基于 2020–2026 实盘队列留存率 (<code>ret24_pct</code>) 与报考平均级别漂移 (<code>avg_lvl</code>)，系统自动区分<strong>「🚨 疑似被高返佣渠道分流机构 (Bucket B)」</strong>与<strong>「📉 100%忠诚但琴行新生断档机构 (Bucket A)」</strong>。通过<strong>「仅限本考级办在籍考生专享低于市面价 80% 的 AI 五维考官测评 (¥9.9) + 音基题库 (¥9.9) + 免费高清考级视频云档案」</strong>，让家长主动指定在本考级办报名：
        </p>
        <div class="grid" id="adm-studio-intelligence-box">正在从 PostgreSQL 计算机构留存归因...</div>
      </div>

      <div class="card">
        <h2>📊 2020–2026 历年「全年合并 (寒假+暑假)」季节性分布、分考期明细与 Top 10 合作老师</h2>
        <div class="grid" id="adm-archive-breakdown">正在加载实盘统计...</div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 0: MOM & WIFE 2-USE-CASE GIANT-FONT WORKBENCH                   -->
    <!-- =================================================================== -->
    <section id="tab-mom" class="hidden" style="font-size:19px;line-height:1.6">
      <!-- WECHAT LOGIN & FAMILY IDENTITY BINDING CARD -->
      <div class="card" style="background:#ecfdf5;border:3px solid #16a34a;padding:18px 20px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
          <div>
            <div style="font-size:23px;font-weight:800;color:#065f46">
              👵 考级办日常极简大字台 · <span id="mom-operator-badge" style="color:#047857">老妈 (谈老师) / 老婆专属微信台</span>
            </div>
            <div id="mom-wx-session-status" style="font-size:18px;color:#047857;margin-top:6px;font-weight:700">
              🟢 正在检查「江西小戈尔文化艺术有限公司考级办管理后台」微信连接状态...
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-primary" style="font-size:19px;padding:12px 20px;border-radius:12px" onclick="momStartWeChatLogin()">
              📱 微信扫码连接国音后台 (扫一次全天通用)
            </button>
            <button class="btn-outline" style="font-size:18px;padding:12px 16px;border-radius:12px;background:#fff;font-weight:700" onclick="momBindOperator('老妈 (谈老师)')">
              👵 我是老妈 · 记住我
            </button>
            <button class="btn-outline" style="font-size:18px;padding:12px 16px;border-radius:12px;background:#fff;font-weight:700" onclick="momBindOperator('老婆')">
              👩 我是老婆 · 记住我
            </button>
          </div>
        </div>

        <!-- Expandable Large WeChat QR Box for Mom / Wife -->
        <div id="mom-wx-qr-drawer" class="hidden" style="margin-top:16px;background:#ffffff;border:3px solid #16a34a;border-radius:16px;padding:20px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#065f46;margin-bottom:8px">
            📱 请用【老妈（谈老师）】或【老婆】的手机微信扫一扫下方二维码
          </div>
          <div style="font-size:18px;color:#475569;margin-bottom:14px">
            扫完后在手机微信点一下「确认登录」，电脑和手机就自动连上国音考级后台了：
          </div>
          <div id="mom-wx-qr-img" style="width:240px;height:240px;margin:0 auto;border:3px solid #86efac;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#047857;background:#f8fafc">
            正在拉取国音后台二维码...
          </div>
          <div id="mom-wx-qr-hint" style="font-size:20px;font-weight:800;color:#d97706;margin-top:12px">
            ⏳ 等待手机微信扫码确认中...
          </div>
        </div>
      </div>

      <!-- USE CASE 1: UPLOAD PAST CERTIFICATES / SCORE SCREENSHOTS / ID PHOTOS -->
      <div class="card" style="border:3px solid #2563eb;padding:20px">
        <div style="font-size:22px;font-weight:800;color:#1e40af;margin-bottom:8px">
          📸 第一件事：传「过往考级证书 / 成绩截图」或「换考生证件照」
        </div>
        <div style="font-size:17px;color:#334155;margin-bottom:12px">
          自动区分<strong>专业证书 (填证书1)</strong>、<strong>音基证书/成绩截图 (填证书2)</strong>、<strong>考生二寸照 (填考生列表-照片)</strong>；自动抓出<strong>同音字（如 熊祉玥→熊祉钥）</strong>和<strong>同名学生（如 两个陈雨馨）</strong>，自动校验 <code>21</code> 开头的 18 位证书编号：
        </div>

        <!-- Giant WeChat Photo Picker / Drag & Drop Zone -->
        <div id="mom-drop-zone"
          onclick="document.getElementById('mom-file-input').click()"
          ondragover="event.preventDefault();this.style.background='#dbeafe'"
          ondragleave="this.style.background='#eff6ff'"
          ondrop="momHandleFileDrop(event)"
          style="background:#eff6ff;border:3px dashed #2563eb;border-radius:16px;padding:18px;text-align:center;cursor:pointer;margin-bottom:14px">
          <input type="file" id="mom-file-input" accept="image/*" style="display:none" onchange="momHandleFileSelect(this.files)" />
          <div style="font-size:22px;font-weight:800;color:#1d4ed8">
            📂 点这里从手机相册/电脑选微信收到的照片（或直接把微信照片拖进来）
          </div>
          <div style="font-size:17px;color:#475569;margin-top:4px">
            支持证书照片（如 <code>熊祉玥_钢琴4级.jpg</code>）、手机成绩查询截图、或孩子二寸证件照（如 <code>詹子妍.jpg</code>）
          </div>
          <div id="mom-local-preview-wrap" class="hidden" style="margin-top:12px;display:inline-flex;align-items:center;gap:14px;background:#fff;padding:10px 16px;border-radius:12px;border:2px solid #60a5fa">
            <img id="mom-local-preview-img" src="" style="height:96px;border-radius:8px;border:1px solid #cbd5e1" />
            <div style="text-align:left">
              <div style="font-size:18px;font-weight:800;color:#1e40af" id="mom-local-preview-name">已选照片</div>
              <div style="font-size:15px;color:#047857">✅ 已就绪，核对下方考生后点绿色按钮即可一键上传</div>
            </div>
          </div>
        </div>

        <!-- Direct Official look_score (https://kjzx002120.kj5.zgyyxykj.com/index/index/look_score) Query & Auto-Proof Generator -->
        <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:14px;padding:14px 16px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">
            <div style="font-size:19px;font-weight:800;color:#14532d">
              🔎 免家长截图！直连《中国音乐学院·考级成绩查询》(<code>/index/index/look_score</code>)
            </div>
            <a href="https://kjzx002120.kj5.zgyyxykj.com/index/index/look_score" target="_blank" rel="noopener"
              style="font-size:16px;font-weight:700;color:#15803d;text-decoration:underline">
              🔗 在新窗口打开国音官网成绩查询页 ↗
            </a>
          </div>
          <div style="font-size:16.5px;color:#166534;margin-bottom:10px">
            家长发的成绩截图经常被截断（缺专业名或发证日期）。在这里输入<strong>姓名</strong>（可加身份证号或后4位），<strong>1秒查出历年通过级别与 <code>21</code> 开头18位证书编号，并一键生成完整不截断的《成绩查询合格图》直接填入证书1/证书2</strong>：
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <input id="mom-ls-name" value="樊骏衡" placeholder="考生姓名 (如：樊骏衡 / 陈雨馨)" style="font-size:19px;padding:10px 14px;width:210px;font-weight:700" onkeydown="if(event.key==='Enter') momQueryLookScore(false)" />
            <input id="mom-ls-idcard" value="" placeholder="证件号码 (选填，完整号可调官网旋转验证)" style="font-size:18px;padding:10px 14px;flex:1;min-width:240px" onkeydown="if(event.key==='Enter') momQueryLookScore(false)" />
            <button class="btn-primary" style="font-size:18px;padding:11px 18px;border-radius:10px" onclick="momQueryLookScore(false)">
              ⚡ 秒查成绩与18位证书号 (免验证码)
            </button>
            <button class="btn-outline" style="font-size:17px;padding:11px 16px;border-radius:10px;background:#fff;font-weight:700" onclick="momQueryLookScore(true)">
              🌐 调官网旋转验证码实时查 look_score
            </button>
          </div>
          <!-- Captcha iframe drawer when querying live look_score with full ID card -->
          <div id="mom-ls-captcha-wrap" class="hidden" style="margin-top:12px;background:#fff;border:2px solid #f59e0b;border-radius:12px;padding:12px;text-align:center">
            <div style="font-size:18px;font-weight:800;color:#b45309;margin-bottom:6px">🔄 请拖动下方滑块将图片旋转摆正，完成后自动向 <code>look_score</code> 发起查询：</div>
            <iframe id="mom-ls-captcha-ifr" src="" style="width:360px;height:340px;border:none;border-radius:10px;background:#f8fafc"></iframe>
          </div>
          <div id="mom-ls-results" style="margin-top:10px"></div>
        </div>

        <!-- 1-Click Real Presets from Mom's Actual August 2026 Batches -->
        <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:12px;padding:12px 14px;margin-bottom:14px">
          <div style="font-size:17px;font-weight:700;color:#1e3a8a;margin-bottom:8px">👇 或者点一下体验 8 月份真实待传案例（直接调取实盘数据库核验）：</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-primary" style="font-size:17px;padding:10px 16px" onclick="momPresetCase('熊祉玥_钢琴4级.jpg','熊祉玥','cert','钢琴',4,'2023-11-15','中国音乐学院考级委员会','212023080020688823')">
              📄 案例1：熊祉玥_钢琴4级.jpg (自动抓出同音字「熊祉钥」)
            </button>
            <button class="btn-wecom" style="font-size:17px;padding:10px 16px" onclick="momPresetCase('陈雨馨_成绩查询.jpg','陈雨馨','score_screenshot','钢琴',3,'2025年暑假','中国音乐学院','')">
              📱 案例2：陈雨馨_成绩查询.jpg (同名提醒 + 自动补全18位证书号)
            </button>
            <button class="btn-purple" style="font-size:17px;padding:10px 16px" onclick="momPresetCase('樊骏衡_成绩查询.jpg','樊骏衡','score_screenshot','音乐基础知识',3,'2025年暑假','中国音乐学院','')">
              🎹 案例3：樊骏衡_成绩查询.jpg (自动找回往期已传音基3级原件)
            </button>
            <button class="btn-outline" style="font-size:17px;padding:10px 16px;background:#fff" onclick="momPresetCase('詹子妍.jpg','詹子妍','id_photo','',0,'','','')">
              👧 案例4：詹子妍.jpg (换二寸证件照·新旧对比)
            </button>
          </div>
        </div>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px">
          <div>
            <label style="font-size:17px">① 图片文件名</label>
            <input id="mom-up-filename" value="熊祉玥_钢琴4级.jpg" style="font-size:19px;padding:11px;font-weight:700" />
          </div>
          <div>
            <label style="font-size:17px">② 考生姓名 (找不着可只填姓)</label>
            <input id="mom-up-name" value="熊祉玥" style="font-size:19px;padding:11px;font-weight:700" onkeydown="if(event.key==='Enter') momStageCertOrPhoto()" />
          </div>
          <div>
            <label style="font-size:17px">③ 用途分类</label>
            <select id="mom-up-kind" style="font-size:19px;padding:11px;font-weight:700" onchange="momStageCertOrPhoto()">
              <option value="auto">🤖 自动识别 (按文件名/内容)</option>
              <option value="cert" selected>📜 纸质考级证书 (填证书1/证书2)</option>
              <option value="score_screenshot">📱 成绩查询手机截图 (填证书1/证书2)</option>
              <option value="id_photo">👧 考生二寸证件照 (换考生照片)</option>
            </select>
          </div>
          <div>
            <label style="font-size:17px">④ 证书专业 (音基自动归证书2)</label>
            <input id="mom-up-major" value="钢琴" placeholder="如：钢琴 / 音乐基础知识" style="font-size:19px;padding:11px" />
          </div>
          <div>
            <label style="font-size:17px">⑤ 证书级别 (阿拉伯数字)</label>
            <input id="mom-up-level" value="4" placeholder="如：4" style="font-size:19px;padding:11px" />
          </div>
          <div>
            <label style="font-size:17px">⑥ 发证日期或考期 (暑假→10-24)</label>
            <input id="mom-up-date" value="2023-11-15" placeholder="2025年暑假 或 2025-10-24" style="font-size:19px;padding:11px" />
          </div>
          <div>
            <label style="font-size:17px">⑦ 考级委员会名称</label>
            <input id="mom-up-school" value="中国音乐学院考级委员会" style="font-size:19px;padding:11px" />
          </div>
          <div>
            <label style="font-size:17px">⑧ 18位证书编号 (21开头，非NO.)</label>
            <input id="mom-up-certno" value="212023080020688823" placeholder="成绩截图可留空" style="font-size:19px;padding:11px" />
          </div>
        </div>

        <div style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">
          <button class="btn-primary" style="font-size:21px;padding:14px 28px;border-radius:12px" onclick="momStageCertOrPhoto()">
            🔍 第一步：自动认人 + 核对旧照与证书位置
          </button>
        </div>

        <div id="mom-stage-result" style="margin-top:16px"></div>

        <!-- Shared Mom & Wife Today Upload Log -->
        <div style="margin-top:18px;background:#f8fafc;border:2px solid #cbd5e1;border-radius:14px;padding:14px 16px">
          <div style="font-size:19px;font-weight:800;color:#0f172a;margin-bottom:8px">
            📋 今日已办妥清单（老妈与老婆实时共享进度，防止重复上传）：
          </div>
          <div id="mom-upload-log-box" style="font-size:17px;color:#475569">正在加载今日已传记录...</div>
        </div>
      </div>

      <!-- USE CASE 2: TEACHER REGISTRATION FEE TALLY & PRE-EXAM FILING TABLE -->
      <div class="card" style="border:3px solid #7c3aed;padding:20px">
        <div style="font-size:22px;font-weight:800;color:#5b21b6;margin-bottom:8px">
          📊 第二件事：按机构/老师一键算「考级费用统计单」+「考前备案表 (各专业1-10级人数)」
        </div>
        <div style="font-size:17px;color:#475569;margin-bottom:12px">
          不用导出 Excel、更不用重新扫二维码！支持按<strong>单考期 (暑假/寒假)</strong>或<strong>全年合并 (寒假+暑假)</strong>查看，<strong>1秒算出器乐几人、音基几人、每个级别几人、一共应收多少报名费，并列出全部学生名单</strong>，点一下直接复制发微信给老师对账：
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
          <div style="min-width:250px">
            <label style="font-size:17px">选择考级计划 (单考期 或 全年寒暑合并)</label>
            <select id="mom-report-season" style="font-size:20px;padding:12px;font-weight:700" onchange="momLoadTeacherFeeReport()">
              <option value="20264" selected>2026年暑假 (20264 · 当前考期)</option>
              <option value="20265">2026年寒假 (20265)</option>
              <option value="2026">🔥 2026全年合并 (寒假532+暑假1706=2238人)</option>
              <option value="2025">🔥 2025全年合并 (寒假689+暑假2437=3126人)</option>
              <option value="20254">2025年暑假 (20254 · 2437人)</option>
              <option value="20255">2025年寒假 (20255 · 689人)</option>
              <option value="2024">🔥 2024全年合并 (寒假813+暑假3264=4077人)</option>
              <option value="20244">2024年暑假 (20244 · 3264人)</option>
              <option value="2023">🔥 2023全年合并 (寒假786+暑假4186=4972人)</option>
            </select>
          </div>
          <div style="flex:1;min-width:240px">
            <label style="font-size:17px">输入机构/老师姓名（如：周玲、黄庆华、陈静；留空查全季/全年汇总）</label>
            <input id="mom-report-agent" value="周玲" placeholder="输入老师姓名，如：周玲"
              style="font-size:20px;padding:12px;border:2px solid #7c3aed;border-radius:10px;font-weight:700"
              onkeydown="if(event.key==='Enter') momLoadTeacherFeeReport()" />
          </div>
          <button class="btn-purple" style="font-size:20px;padding:13px 24px;border-radius:12px" onclick="momLoadTeacherFeeReport()">
            🧮 立即生成老师费用账单
          </button>
          <button class="btn-outline" style="font-size:18px;padding:13px 18px;border-radius:12px" onclick="document.getElementById('mom-report-agent').value='';momLoadTeacherFeeReport()">
            📋 查看全季/全年《考前备案表》矩阵
          </button>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <span style="font-size:16px;color:#64748b">常查老师快捷点选：</span>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('周玲','20264')">周玲 (2026暑假)</button>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('周玲','2026')">周玲 (2026全年合并)</button>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('黄庆华','2025')">黄庆华 (2025全年合并)</button>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('胡杰友','2025')">胡杰友 (2025全年合并)</button>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('陈静','2025')">陈静 (2025全年合并)</button>
          <button class="btn-outline btn-sm" style="font-size:16px" onclick="momQuickTeacherReport('许张','2025')">许张 (2025全年合并)</button>
        </div>

        <div id="mom-fee-report-box">正在计算机构报名统计...</div>
      </div>
    </section>
  </div>

  <nav class="bottom-nav">
    <button id="nav-mom" class="nav-btn" onclick="switchTab('mom')" style="color:#b45309;font-weight:800">👵 妈妈大字台</button>
    <button id="nav-parent" class="nav-btn active" onclick="switchTab('parent')">📝 我要报名</button>
    <button id="nav-archive" class="nav-btn" onclick="switchTab('archive')">🏅 考级档案</button>
    <button id="nav-teacher" class="nav-btn" onclick="switchTab('teacher')">👩‍🏫 合作老师专席</button>
    <button id="nav-console" class="nav-btn" onclick="switchTab('console')">🏛️ 考级办总控</button>
  </nav>

  <script>
    const LEVEL_FEES = { 1:200, 2:240, 3:280, 4:320, 5:360, 6:390, 7:420, 8:450, 9:480, 10:510, 11:620 };
    const SUBJECT_MAP_CN_TO_ID = {
      '钢琴': 'piano',
      '古筝': 'guzheng',
      '小提琴': 'violin',
      '音乐基础知识': 'music_theory',
      '民谣吉他': 'guitar',
      '古典吉他': 'guitar',
      '二胡': 'erhu',
      '琵琶': 'pipa',
      '长笛': 'flute',
      '萨克斯': 'saxophone',
      '少儿声乐': 'vocal',
      '美声唱法': 'vocal',
      '民族唱法': 'vocal',
      '通俗唱法': 'vocal'
    };

    // Current session state resolved from URL (?invite=..., ?ref=..., ?role=...)
    let currentSession = {
      role: 'admin',
      is_isolated: false,
      locked_agent: null
    };

    function mediaProxyUrl(rawUrl, type, studentId, examId) {
      if (!rawUrl) return '';
      const p = new URLSearchParams();
      p.set('url', rawUrl);
      if (type) p.set('type', type);
      if (studentId) p.set('student_id', String(studentId));
      if (examId) p.set('exam_id', String(examId));
      return '/official-sync/media-proxy?' + p.toString();
    }

    function playVideoLocally(encodedUrl, encodedTitle, studentId, examId) {
      const rawUrl = decodeURIComponent(encodedUrl);
      const title = decodeURIComponent(encodedTitle);
      const proxyUrl = mediaProxyUrl(rawUrl, 'video', studentId, examId);
      const drawer = document.getElementById('local-video-drawer');
      const player = document.getElementById('local-video-player');
      document.getElementById('local-video-title').textContent = title;
      document.getElementById('local-video-raw-link').href = rawUrl;
      drawer.classList.remove('hidden');
      player.src = proxyUrl;
      player.play().catch(() => {});
      drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      showToast('🎬 正在通过上海本地 MinIO 缓存通道播放：' + title);
    }

    function closeLocalVideoPlayer() {
      const player = document.getElementById('local-video-player');
      player.pause();
      player.removeAttribute('src');
      document.getElementById('local-video-drawer').classList.add('hidden');
    }

    async function prebufferStudentVideos(studentId, studentName) {
      showToast(\`⏳ 正在将「\${studentName}」历年全部考级视频与证件照下载缓存至上海本地 MinIO...\`);
      try {
        const res = await fetch('/official-sync/media-prebuffer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_id: Number(studentId), limit: 15 })
        }).then(r => r.json());
        showToast(\`✅ 「\${studentName}」本地缓存完成：共 \${res.buffered_count || 0} 个视频/照片 (\${res.total_buffered_mb || 0} MB) 已落盘上海 MinIO！\`);
      } catch (e) {
        showToast('缓存请求异常: ' + e.message);
      }
    }

    async function prebufferBatchMedia(seasonCode, limit) {
      showToast(\`⏳ 正在后台批量拉取 \${seasonCode} 考季前 \${limit} 条视频至本地 MinIO...\`);
      const res = await fetch('/official-sync/media-prebuffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season_code: seasonCode, limit: Number(limit || 6) })
      }).then(r => r.json());
      showToast(\`✅ 批量预缓存完成：共缓存 \${res.buffered_count || 0} 个媒体文件 (\${res.total_buffered_mb || 0} MB)！\`);
      loadMediaCacheStats();
    }

    async function loadMediaCacheStats() {
      try {
        const st = await fetch('/official-sync/media-cache-stats').then(r => r.json());
        if (document.getElementById('mc-total-videos')) {
          document.getElementById('mc-total-videos').textContent = '66,214 条';
          document.getElementById('mc-cached-videos').textContent = (st.cached_videos || 0) + ' 条';
          document.getElementById('mc-cached-photos').textContent = (st.cached_photos || 0) + ' 张';
          document.getElementById('mc-cached-mb').textContent = (st.total_size_mb || 0) + ' MB';
        }
      } catch {}
    }

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 3400);
    }

    let momSelectedImageBase64 = '';
    let momWxPollTimer = null;

    async function momCheckWeChatSession() {
      const el = document.getElementById('mom-wx-session-status');
      const badge = document.getElementById('mom-operator-badge');
      const savedOp = localStorage.getItem('mea_operator_name');
      if (savedOp && badge) {
        badge.textContent = \`当前已登录：\${savedOp}（下次打开微信直接进入本页）\`;
      }
      if (!el) return;
      try {
        const st = await fetch('/official-sync/session-status').then(r => r.json());
        if (st.has_active_session) {
          el.innerHTML = \`🟢 <strong>国音考级后台微信已在线连接</strong>（会话ID: <code>\${st.session?.php_sess_id_masked || 'active'}</code> · 登录时间: \${(st.session?.authenticated_at || '').slice(0, 19).replace('T', ' ')}）— 可直接一键传证书/换照片！\`;
          el.style.color = '#047857';
        } else {
          el.innerHTML = '🟡 <strong>查老师账单、算考前备案表免扫码直接可用！</strong>如需直接把证书/照片写入国音官网，请点右侧「📱 微信扫码连接国音后台」用老妈或老婆微信扫一下：';
          el.style.color = '#b45309';
        }
      } catch {}
    }

    function momBindOperator(opName) {
      localStorage.setItem('mea_operator_name', opName);
      localStorage.setItem('mea_default_tab', 'mom');
      const badge = document.getElementById('mom-operator-badge');
      if (badge) badge.textContent = \`当前已绑定：\${opName}（以后点开链接自动进大字台）\`;
      const pill = document.getElementById('role-identity-pill');
      if (pill) pill.textContent = \`👵 \${opName} · 专属微信大字台\`;
      showToast(\`✅ 已记住您的身份为「\${opName}」！以后在微信点开链接会自动直接打开本页。\`);
    }

    async function momStartWeChatLogin() {
      const drawer = document.getElementById('mom-wx-qr-drawer');
      const imgBox = document.getElementById('mom-wx-qr-img');
      const hintBox = document.getElementById('mom-wx-qr-hint');
      if (!drawer || !imgBox || !hintBox) return;
      drawer.classList.remove('hidden');
      imgBox.innerHTML = '⏳ 正在向国音考级后台请求微信登录二维码...';
      hintBox.textContent = '⏳ 请稍候，二维码生成中...';
      if (momWxPollTimer) clearInterval(momWxPollTimer);

      try {
        const res = await fetch('/official-sync/qr-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).then(r => r.json());

        if (res.qr_image_base64) {
          imgBox.innerHTML = \`<img src="\${res.qr_image_base64}" style="width:232px;height:232px;object-fit:contain;border-radius:10px" />\`;
          hintBox.textContent = '📱 请拿老妈（谈老师）或老婆的手机微信扫一扫上方二维码，并在手机上点「确认登录」';
        } else {
          imgBox.textContent = '二维码获取失败，请再点一次';
          return;
        }

        momWxPollTimer = setInterval(async () => {
          try {
            const p = await fetch('/official-sync/wxauth-poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ php_sess_id: res.php_sess_id, wxauth_token: res.wxauth_token })
            }).then(r => r.json());

            if (p.authenticated) {
              clearInterval(momWxPollTimer);
              localStorage.setItem('mea_default_tab', 'mom');
              if (!localStorage.getItem('mea_operator_name')) {
                localStorage.setItem('mea_operator_name', '老妈/老婆 (微信扫码已认证)');
              }
              hintBox.style.color = '#047857';
              hintBox.textContent = '🎉 微信扫码登录成功！已连接「江西小戈尔文化艺术有限公司考级办管理后台」！';
              setTimeout(() => drawer.classList.add('hidden'), 2200);
              momCheckWeChatSession();
              showToast('🎉 微信扫码登录成功！现在点绿色按钮可直接写入国音考级后台！');
            }
          } catch {}
        }, 2000);
      } catch (e) {
        hintBox.textContent = '连接失败: ' + e.message;
      }
    }

    function momHandleFileDrop(ev) {
      ev.preventDefault();
      const dz = document.getElementById('mom-drop-zone');
      if (dz) dz.style.background = '#eff6ff';
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length > 0) {
        momHandleFileSelect(ev.dataTransfer.files);
      }
    }

    function momHandleFileSelect(fileList) {
      if (!fileList || fileList.length === 0) return;
      const f = fileList[0];
      document.getElementById('mom-up-filename').value = f.name;
      // Parse filename convention if present (e.g. 熊祉玥_钢琴4级.jpg or 詹子妍.jpg)
      const base = f.name.replace(/\\.[a-zA-Z0-9]+$/, '').trim();
      if (base.includes('_')) {
        const [nm, desc] = base.split('_', 2);
        document.getElementById('mom-up-name').value = nm.trim();
        if (desc.includes('成绩')) {
          document.getElementById('mom-up-kind').value = 'score_screenshot';
        } else {
          document.getElementById('mom-up-kind').value = 'cert';
          const lvM = desc.match(/([0-9]{1,2})级/);
          if (lvM) document.getElementById('mom-up-level').value = lvM[1];
          const maj = desc.replace(/([0-9]{1,2})级.*$/, '').trim();
          if (maj) document.getElementById('mom-up-major').value = maj === '音基' ? '音乐基础知识' : maj;
        }
      } else if (/^[\\u4e00-\\u9fa5]{2,4}$/.test(base)) {
        document.getElementById('mom-up-name').value = base;
        document.getElementById('mom-up-kind').value = 'id_photo';
      }

      const reader = new FileReader();
      reader.onload = function(e) {
        momSelectedImageBase64 = String(e.target.result || '');
        const wrap = document.getElementById('mom-local-preview-wrap');
        const img = document.getElementById('mom-local-preview-img');
        const nmEl = document.getElementById('mom-local-preview-name');
        if (wrap && img && nmEl) {
          img.src = momSelectedImageBase64;
          nmEl.textContent = \`本次选中图片：\${f.name} (\${Math.round(f.size / 1024)} KB)\`;
          wrap.classList.remove('hidden');
        }
        momStageCertOrPhoto();
      };
      reader.readAsDataURL(f);
    }

    function momPresetCase(filename, name, kind, major, level, dateStr, school, certNo) {
      momSelectedImageBase64 = '';
      document.getElementById('mom-local-preview-wrap')?.classList.add('hidden');
      document.getElementById('mom-up-filename').value = filename;
      document.getElementById('mom-up-name').value = name;
      if (document.getElementById('mom-ls-name')) document.getElementById('mom-ls-name').value = name;
      document.getElementById('mom-up-kind').value = kind;
      document.getElementById('mom-up-major').value = major || '';
      document.getElementById('mom-up-level').value = level ? String(level) : '';
      document.getElementById('mom-up-date').value = dateStr || '';
      document.getElementById('mom-up-school').value = school || '中国音乐学院考级委员会';
      document.getElementById('mom-up-certno').value = certNo || '';
      momStageCertOrPhoto();
    }

    let momCurrentCaptchaKey = '';
    window.addEventListener('message', function(ev) {
      const msg = String(ev.data || '');
      if (msg === 'on_captcha_success' && momCurrentCaptchaKey) {
        document.getElementById('mom-ls-captcha-wrap')?.classList.add('hidden');
        showToast('✅ 旋转验证码通过！正在向国音 look_score 实时查询...');
        momExecuteLookScorePost(momCurrentCaptchaKey);
      } else if (msg === 'on_captcha_close') {
        document.getElementById('mom-ls-captcha-wrap')?.classList.add('hidden');
      }
    });

    async function momQueryLookScore(useLiveCaptcha) {
      const name = (document.getElementById('mom-ls-name')?.value || '').trim();
      const idCard = (document.getElementById('mom-ls-idcard')?.value || '').trim();
      if (!name) {
        showToast('请先输入考生姓名！');
        return;
      }
      if (useLiveCaptcha) {
        if (!idCard || idCard.length < 8) {
          showToast('💡 调取国音官网旋转验证码需填写完整证件号码；若只有姓名请点左侧「⚡ 秒查成绩与18位证书号」！');
          return;
        }
        const cap = await fetch('/official-sync/look-score-captcha').then(r => r.json());
        if (cap.ok && cap.captcha_iframe_src) {
          momCurrentCaptchaKey = cap.captcha_check_key;
          const wrap = document.getElementById('mom-ls-captcha-wrap');
          const ifr = document.getElementById('mom-ls-captcha-ifr');
          if (wrap && ifr) {
            ifr.src = cap.captcha_iframe_src;
            wrap.classList.remove('hidden');
          }
          return;
        }
      }
      await momExecuteLookScorePost('');
    }

    async function momExecuteLookScorePost(captchaKey) {
      const name = (document.getElementById('mom-ls-name')?.value || '').trim();
      const idCard = (document.getElementById('mom-ls-idcard')?.value || '').trim();
      const resBox = document.getElementById('mom-ls-results');
      if (!resBox) return;
      resBox.innerHTML = '<div style="font-size:18px;color:#15803d;font-weight:700">⏳ 正在查询考级成绩与证书编号...</div>';
      try {
        const res = await fetch('/official-sync/look-score-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, id_card: idCard, captcha_check_key: captchaKey })
        }).then(r => r.json());

        const rows = [...(res.live_official_rows || []), ...(res.local_archive_rows || [])];
        if (rows.length === 0) {
          resBox.innerHTML = \`<div style="font-size:18px;color:#b91c1c;font-weight:700">未查到「\${name}」的成绩记录 \${res.live_official_error ? '(' + res.live_official_error + ')' : ''}</div>\`;
          return;
        }
        resBox.innerHTML = rows.slice(0, 10).map(r => \`
          <div style="background:\${r.is_highest_for_major ? '#ffffff' : '#f8fafc'};border:\${r.is_highest_for_major ? '2px solid #16a34a' : '1px dashed #cbd5e1'};border-radius:10px;padding:10px 14px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:18px;opacity:\${r.is_highest_for_major ? '1' : '0.78'}">
            <div>
              <span class="badge badge-confirmed" style="font-size:14px">\${r.source === 'live_look_score' ? '🌐 官网 look_score 实时' : '⚡ 本考点成绩库'}</span>
              \${r.is_highest_for_major ? \`<span class="badge" style="background:#fef3c7;color:#92400e;font-size:14px;font-weight:800">🏆 \${r.major_name}最高等级（推荐上传）</span>\` : \`<span class="badge" style="background:#e2e8f0;color:#475569;font-size:13px">⚪ 往期较低等级（已有更高证书）</span>\`}
              <strong>\${r.student_name}</strong> \${r.birthday ? \`(生日:\${r.birthday} · 老师:\${r.agent_name || '—'})\` : ''}
              ｜ <strong>\${r.major_name} \${r.pass_level}级</strong>
              ｜ 考试时间：<strong>\${r.exam_time_label}</strong> (发证日: <code>\${r.derived_issue_date}</code>)
              ｜ 结果：<strong style="color:#15803d">\${r.score_result}</strong>
              \${r.cert_no ? \`｜ 18位证书号：<code style="font-weight:800;color:#1d4ed8">\${r.cert_no}</code>\` : ''}
            </div>
            <button class="\${r.is_highest_for_major ? 'btn-primary' : 'btn-outline'}" style="font-size:17px;padding:8px 16px;border-radius:8px"
              onclick="momGenerateLookScoreImageAndFill('\${r.student_name}', '\${r.sex || '女'}', '\${r.major_name}', '\${r.pass_level}', '\${r.exam_time_label}', '\${r.exam_way_label}', '\${r.score_result}', '\${r.derived_issue_date}', '\${r.cert_no || ''}', '')">
              🪄 一键生成《\${r.major_name}\${r.pass_level}级》合格图并填入\${r.target_cert_index === 1 ? '【证书2·音基】' : '【证书1·专业】'}
            </button>
          </div>
        \`).join('');
      } catch (e) {
        resBox.innerHTML = '<div style="color:red">查询出错: ' + e.message + '</div>';
      }
    }

    function momGenerateLookScoreImageAndFill(studentName, sex, majorName, passLevel, examTimeLabel, examWayLabel, scoreResult, issueDate, certNo, existingPicUrl) {
      // If we don't already have an existing picture URL, draw an official-style full (untruncated!) look_score result image on <canvas>
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 880;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createLinearGradient(0, 0, 0, 880);
        grad.addColorStop(0, '#c6f3ff');
        grad.addColorStop(0.5, '#b9eefe');
        grad.addColorStop(1, '#3bb0fa');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 720, 880);

        // Header bar matching https://kjzx002120.kj5.zgyyxykj.com/index/index/look_score
        ctx.fillStyle = '#23aafe';
        ctx.fillRect(40, 40, 640, 72);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('中国音乐学院 · 考级成绩查询', 360, 87);

        // Inner result card
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(40, 112, 640, 680);

        ctx.fillStyle = '#334155';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(majorName + '    ' + passLevel + '级', 75, 170);

        // Gray table2 box matching look_score CSS
        ctx.fillStyle = '#efefef';
        ctx.fillRect(65, 195, 590, 440);

        const rows = [
          ['考生姓名：', studentName],
          ['考生性别：', sex || '—'],
          ['考试专业：', majorName],
          ['考试级别：', String(passLevel)],
          ['考试时间：', examTimeLabel || issueDate],
          ['考试方式：', examWayLabel || '视频考试'],
          ['通过级别：', String(passLevel)],
          ['证书编号：', certNo || '官网成绩查询核验通过'],
          ['获得年月：', issueDate]
        ];
        ctx.font = '23px sans-serif';
        rows.forEach((r, idx) => {
          const y = 242 + idx * 45;
          ctx.fillStyle = '#475569';
          ctx.fillText(r[0], 95, y);
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 23px sans-serif';
          ctx.fillText(String(r[1]), 250, y);
          ctx.font = '23px sans-serif';
        });

        // Blue pass bar (.extra-div.btn-info)
        ctx.fillStyle = '#31b0d5';
        ctx.fillRect(95, 665, 530, 58);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(scoreResult || '合格', 360, 704);

        ctx.fillStyle = '#64748b';
        ctx.font = '17px sans-serif';
        ctx.fillText('来源：kjzx002120.kj5.zgyyxykj.com/index/index/look_score 官方成绩核验', 360, 765);

        momSelectedImageBase64 = canvas.toDataURL('image/jpeg', 0.9);
        const wrap = document.getElementById('mom-local-preview-wrap');
        const img = document.getElementById('mom-local-preview-img');
        const nmEl = document.getElementById('mom-local-preview-name');
        if (wrap && img && nmEl) {
          img.src = momSelectedImageBase64;
          nmEl.textContent = \`已自动生成完整《\${studentName}_\${majorName}\${passLevel}级_成绩查询.jpg》\`;
          wrap.classList.remove('hidden');
        }
      }

      document.getElementById('mom-up-filename').value = \`\${studentName}_\${majorName}\${passLevel}级_成绩查询.jpg\`;
      document.getElementById('mom-up-name').value = studentName;
      document.getElementById('mom-up-kind').value = 'score_screenshot';
      document.getElementById('mom-up-major').value = majorName;
      document.getElementById('mom-up-level').value = String(passLevel);
      document.getElementById('mom-up-date').value = issueDate;
      document.getElementById('mom-up-school').value = '中国音乐学院考级委员会';
      document.getElementById('mom-up-certno').value = certNo || '';

      showToast(\`🪄 已生成「\${studentName} · \${majorName}\${passLevel}级」完整成绩查询图并自动填好 18 位编号！请点下方绿色按钮一键写入后台。\`);
      momStageCertOrPhoto();
    }

    async function momStageCertOrPhoto() {
      const box = document.getElementById('mom-stage-result');
      if (!box) return;
      box.innerHTML = '<div style="font-size:20px;color:#1e40af;font-weight:700">⏳ 正在自动核对考生档案、检测同音字/重名与证书位置...</div>';

      const payload = {
        filename: document.getElementById('mom-up-filename')?.value || '',
        student_name: document.getElementById('mom-up-name')?.value || '',
        kind: document.getElementById('mom-up-kind')?.value || 'auto',
        major_name: document.getElementById('mom-up-major')?.value || '',
        level: document.getElementById('mom-up-level')?.value || '',
        issue_date_or_season: document.getElementById('mom-up-date')?.value || '',
        school: document.getElementById('mom-up-school')?.value || '',
        cert_no: document.getElementById('mom-up-certno')?.value || ''
      };

      try {
        const res = await fetch('/official-sync/stage-cert-or-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => r.json());

        const warningsHtml = (res.warnings || []).map(w =>
          \`<div style="background:#fef2f2;border:2px solid #ef4444;color:#991b1b;padding:12px 16px;border-radius:10px;font-size:19px;font-weight:800;margin-bottom:10px">\${w}</div>\`
        ).join('');

        const p = res.parsed || {};
        const studentsHtml = (res.matched_students || []).map(s => {
          const curExams = s.current_term_exams || [];
          const histExams = s.historical_exams || [];
          const hasCur = Boolean(s.has_current_term_exam);
          const targetExam = curExams[0] || s.recent_exams?.[0] || null;
          const targetExamId = targetExam ? targetExam.exam_id : 0;

          const curRowsHtml = curExams.map(e => {
            const certs = Array.isArray(e.certs_json) ? e.certs_json : [];
            const c1 = certs[0] && (certs[0].picture || certs[0].major_name) ? \`✅ 已传：\${certs[0].major_name || ''}\${certs[0].level || ''}级 \${certs[0].no ? '(' + certs[0].no + ')' : ''}\` : '<span style="color:#dc2626;font-weight:800">❌ 空缺 (待传证书1)</span>';
            const c2 = certs[1] && (certs[1].picture || certs[1].major_name) ? \`✅ 已传：\${certs[1].major_name || '音基'}\${certs[1].level || ''}级 \${certs[1].no ? '(' + certs[1].no + ')' : ''}\` : '<span style="color:#dc2626;font-weight:800">❌ 空缺 (待传证书2)</span>';
            return \`<div style="font-size:19px;padding:8px 12px;background:#ecfdf5;border:2px solid #10b981;border-radius:8px;margin-bottom:6px">
              🎯 <strong>【本期当期报考 · \${e.season_label}】</strong> (报考ID: <code>\${e.exam_id}</code>) · 正在报考 <strong style="color:#047857;font-size:20px">\${e.major_name} \${e.level}级</strong>
              <span class="badge" style="background:#fef3c7;color:#92400e;font-size:15px">⚡ 本次上传/替换的目标记录</span><br/>
              👉 当前证书槽状态：证书1(专业): <strong>\${c1}</strong> ｜ 证书2(音基): <strong>\${c2}</strong>
            </div>\`;
          }).join('');

          const histRowsHtml = histExams.map(e => {
            const passBadge = e.pass_level ? \`<span class="badge badge-confirmed" style="font-size:13px">已通过:\${e.pass_level}级 \${e.cert_no ? '· 编号:' + e.cert_no : ''}</span>\` : '';
            return \`<div style="font-size:16px;color:#64748b;padding:4px 0;border-bottom:1px dashed #e2e8f0">
              📚 往期历史 (\${e.season_label} · ID:\${e.exam_id})：\${e.major_name} \${e.level}级 \${passBadge} <span style="font-size:14px">（往期归档，本次不会修改）</span>
            </div>\`;
          }).join('');

          const discoveredHtml = (s.auto_discovered_certs || []).length > 0
            ? \`<div style="margin-top:10px;background:#eff6ff;border:1.5px solid #93c5fd;border-radius:10px;padding:10px 14px">
                <div style="font-size:17px;font-weight:800;color:#1e3a8a;margin-bottom:6px">
                  🏆 已按专业自动筛选【各门乐器最高等级证书 + 音基最高等级证书】（兼学多门乐器时均保留各自最高级），点一下即可填入【本期当期报考】：
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  \${(s.auto_discovered_certs || []).map(dc => \`
                    <button class="btn-outline btn-sm" style="font-size:16px;background:#fff;border:2px solid \${dc.matches_current_term_major ? '#16a34a' : '#2563eb'};color:\${dc.matches_current_term_major ? '#047857' : '#1d4ed8'};font-weight:800"
                      onclick="momGenerateLookScoreImageAndFill('\${s.name_cn}', '\${s.sex || '女'}', '\${dc.major_name}', '\${dc.pass_level}', '\${dc.season_label}', '', '合格', '\${dc.date}', '\${dc.cert_no || ''}', '\${dc.picture_url || ''}')">
                      \${dc.role_tag || '🏆 最高等级'}：提取「\${dc.major_name}\${dc.pass_level}级 (\${dc.season_label}\${dc.cert_no ? ' · ' + dc.cert_no : ''})」→ 填入本期【证书\${dc.cert_index + 1}】
                    </button>
                  \`).join('')}
                </div>
              </div>\`
            : '';

          const newPhotoPreviewHtml = momSelectedImageBase64
            ? \`<div><div style="font-size:14px;color:#1d4ed8;font-weight:700;margin-bottom:3px">本次新传图片</div><img src="\${momSelectedImageBase64}" style="width:74px;height:96px;object-fit:cover;border-radius:8px;border:3px solid #2563eb" /></div>\`
            : '';

          const cardBorder = hasCur ? '3px solid #16a34a' : '2px dashed #94a3b8';
          const cardBg = hasCur ? '#f0fdf4' : '#f8fafc';
          const termStatusBadge = hasCur
            ? '<span class="badge badge-confirmed" style="font-size:16px;background:#16a34a;color:#fff">🟢 本期 (2026暑假) 在考考生 · 推荐写入</span>'
            : '<span class="badge" style="font-size:16px;background:#e2e8f0;color:#475569">⚪ 往期旧账号 (本期2026暑假无报考 · 请勿误传)</span>';

          return \`
            <div style="border:\${cardBorder};background:\${cardBg};border-radius:14px;padding:16px;margin-top:10px;opacity:\${hasCur ? '1' : '0.82'}">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
                <div style="display:flex;gap:14px;align-items:center">
                  \${s.picture_proxy_url ? \`<div><div style="font-size:14px;color:#065f46;font-weight:700;margin-bottom:3px">当前后台原照</div><img src="\${s.picture_proxy_url}" style="width:74px;height:96px;object-fit:cover;border-radius:8px;border:2px solid #16a34a" /></div>\` : ''}
                  \${newPhotoPreviewHtml}
                  <div>
                    <div style="font-size:23px;font-weight:800;color:#064e3b;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                      <span>👧 考生：\${s.name_cn}</span>
                      <span style="font-size:18px;color:#047857">(ID: \${s.student_id} · \${s.pinyin || '—'})</span>
                      \${termStatusBadge}
                    </div>
                    <div style="font-size:19px;color:#065f46;margin-top:4px">
                      🎂 出生日期：<strong>\${s.birthday || '—'}</strong> ｜ 🪪 证件尾号：<strong>\${s.id_card_masked || '—'}</strong> ｜ 🏫 所属老师：<strong>\${s.agent_name || '—'}</strong>
                    </div>
                    <div style="font-size:19px;color:#1e40af;font-weight:800;margin-top:6px">
                      🎯 拟写入当期位置：\${p.target_slot}
                      \${targetExam ? \` [当期报考ID: \${targetExam.exam_id} · \${targetExam.season_label}]\` : ''}
                      \${p.kind !== 'id_photo' ? \`（填入：\${p.major_name} · \${p.level}级 · 发证日：\${p.date} · 编号：\${p.cert_no || '截图免填'}）\` : ''}
                    </div>
                  </div>
                </div>
                <button class="\${hasCur ? 'btn-primary' : 'btn-outline'}" id="mom-exec-btn-\${s.student_id}" style="font-size:20px;padding:14px 22px;border-radius:12px"
                  onclick="momExecuteUpload(\${s.student_id}, '\${s.name_cn}', \${targetExamId}, '\${p.kind}', \${p.cert_index || 0}, '\${p.major_name || ''}', '\${p.level || ''}', '\${p.date || ''}', '\${p.school || ''}', '\${p.cert_no || ''}', '\${s.picture_url || ''}')">
                  \${hasCur ? \`✅ 确认无误 · 一键写入「\${s.name_cn}」本期(2026暑假)后台\` : \`⚠️ 强制写入此往期旧号 (\${s.student_id})\`}
                </button>
              </div>
              <div style="margin-top:10px;background:#fff;padding:10px 14px;border-radius:10px;border:1px solid #bbf7d0">
                \${curRowsHtml || '<div style="font-size:18px;color:#b45309;font-weight:700">⚠️ 该账号在本期（2026暑假）暂无报考专业记录（仅可更换考生列表证件照，或请核对上方另一个同名在考账号）</div>'}
                \${histRowsHtml ? \`<div style="margin-top:6px">\${histRowsHtml}</div>\` : ''}
              </div>
              \${discoveredHtml}
            </div>
          \`;
        }).join('');

        box.innerHTML = \`
          \${warningsHtml}
          \${studentsHtml || '<div style="font-size:20px;color:#b91c1c;font-weight:700">未匹配到该考生，请只输入姓氏重试。</div>'}
        \`;
      } catch (e) {
        box.innerHTML = '<div style="font-size:19px;color:red">核验出错: ' + e.message + '</div>';
      }
    }

    async function momExecuteUpload(studentId, studentName, examId, kind, certIndex, majorName, level, dateStr, school, certNo, existingPicUrl) {
      const btn = document.getElementById('mom-exec-btn-' + studentId);
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在上传至阿里云 OSS 并写入后台...';
      }
      const opName = localStorage.getItem('mea_operator_name') || '老妈/老婆微信台';
      try {
        const res = await fetch('/official-sync/execute-cert-or-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operator_name: opName,
            student_id: Number(studentId),
            student_name: studentName,
            exam_id: Number(examId || 0),
            filename: document.getElementById('mom-up-filename')?.value || '',
            kind: kind,
            cert_index: Number(certIndex || 0),
            major_name: majorName,
            level: level,
            date: dateStr,
            school: school,
            cert_no: certNo,
            image_base64: momSelectedImageBase64 || '',
            existing_picture_url: existingPicUrl || ''
          })
        }).then(r => r.json());

        if (btn) {
          btn.disabled = false;
          btn.style.background = '#047857';
          btn.textContent = \`🎉 已成功写入「\${studentName}」后台！\`;
        }
        showToast(\`🎉 「\${studentName}」写入成功！\${res.official_msg || ''}\`);
        momStageCertOrPhoto();
        momLoadUploadLog();
      } catch (e) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '重试上传';
        }
        showToast('上传失败: ' + e.message);
      }
    }

    async function momLoadUploadLog() {
      const box = document.getElementById('mom-upload-log-box');
      if (!box) return;
      try {
        const res = await fetch('/official-sync/mom-upload-log').then(r => r.json());
        const items = res.items || [];
        if (items.length === 0) {
          box.innerHTML = '<div style="font-size:17px;color:#64748b">今日暂无上传记录。您或老妈每点一次「确认无误 · 一键上传写入」，这里就会自动打勾记录，不怕两个人重复传！</div>';
          return;
        }
        box.innerHTML = items.slice(0, 12).map((it, idx) => \`
          <div style="padding:8px 10px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:18px">
            <div>
              <span class="badge badge-confirmed" style="font-size:15px">✅ 已办妥 #\${items.length - idx}</span>
              <strong>\${it.student_name}</strong> (ID:\${it.student_id})
              → <strong>\${it.target_slot}</strong>
              \${it.major_name ? \` · \${it.major_name}\${it.level ? it.level + '级' : ''}\` : ''}
              \${it.cert_no ? \` · 编号:<code>\${it.cert_no}</code>\` : ''}
            </div>
            <div style="font-size:15px;color:#047857">
              👤 操作人：<strong>\${it.operator_name}</strong> · \${String(it.created_at || '').slice(11, 19)} · \${it.official_msg || ''}
            </div>
          </div>
        \`).join('');
      } catch {}
    }

    function momQuickTeacherReport(agentName, seasonCode) {
      document.getElementById('mom-report-agent').value = agentName;
      document.getElementById('mom-report-season').value = seasonCode;
      momLoadTeacherFeeReport();
    }

    async function momLoadTeacherFeeReport() {
      const box = document.getElementById('mom-fee-report-box');
      if (!box) return;
      const season = document.getElementById('mom-report-season')?.value || '20264';
      const agentQ = (document.getElementById('mom-report-agent')?.value || '').trim();
      box.innerHTML = '<div style="font-size:20px;color:#5b21b6;font-weight:700">⏳ 正在汇总报考人数与费用明细...</div>';

      try {
        const res = await fetch(\`/official-sync/teacher-fee-and-filing-report?season_code=\${encodeURIComponent(season)}&agent_q=\${encodeURIComponent(agentQ)}\`).then(r => r.json());
        const ts = res.teacher_summary || {};
        const instLvStr = Object.entries(ts.instrument_by_level || {})
          .map(([lv, cnt]) => \`\${lv}级:\${cnt}人 (¥\${(LEVEL_FEES[lv] || 390) * cnt})\`)
          .join(' ｜ ') || '0人';
        const theoLvStr = Object.entries(ts.theory_by_level || {})
          .map(([lv, cnt]) => \`音基\${lv}级:\${cnt}人 (¥\${(LEVEL_FEES[lv] || 200) * cnt})\`)
          .join(' ｜ ') || '0人';

        const studentLinesWechat = (ts.students || []).slice(0, 60).map(s =>
          \`\${s.seq}. \${s.student_name} - \${s.major_name}\${s.level}级 (¥\${s.fee_yuan})\`
        ).join('\\n');
        const wechatBillCopy = encodeURIComponent(
          \`【中国音乐学院九江考级办·机构报名费用核对单】\\n📅 考级计划：\${res.season_label}\\n🏫 机构/老师：\${res.agent_filter}\\n📊 总计报考：\${ts.total_registrations} 人次（器乐/声乐 \${ts.instrument_count} 人次，音乐基础知识 \${ts.theory_count} 人次）\\n💰 官方应收考费总额：¥\${(ts.total_fee_yuan || 0).toLocaleString()}\\n  · 器乐各级别：\${instLvStr}\\n  · 音基各级别：\${theoLvStr}\\n\\n📋 考生明细：\\n\${studentLinesWechat}\`
        );

        const studentRowsHtml = (ts.students || []).slice(0, 80).map(s => \`
          <tr style="font-size:18px">
            <td>\${s.seq}</td>
            <td><strong>\${s.student_name}</strong></td>
            <td>\${s.agent_name}</td>
            <td><strong>\${s.major_name}</strong></td>
            <td><strong>\${s.level}级</strong></td>
            <td><strong style="color:#047857">¥\${s.fee_yuan}</strong></td>
            <td>\${s.cert1_summary ? \`<span class="badge badge-confirmed" style="font-size:14px">✅ \${s.cert1_summary}</span>\` : '<span style="color:#94a3b8;font-size:15px">无证书1</span>'}</td>
            <td>\${s.cert2_summary ? \`<span class="badge badge-confirmed" style="font-size:14px">✅ \${s.cert2_summary}</span>\` : '<span style="color:#94a3b8;font-size:15px">无证书2</span>'}</td>
          </tr>
        \`).join('');

        // Pre-exam filing matrix (考前备案表 · 专业及考官信息)
        const filingRowsHtml = (res.filing_table?.majors || []).map(m => {
          const cells = [1,2,3,4,5,6,7,8,9,10].map(lv => {
            const c = m.levels[lv] || 0;
            return \`<td style="text-align:center;font-size:17px;\${c > 0 ? 'font-weight:800;color:#1e40af;background:#eff6ff' : 'color:#cbd5e1'}">\${c || '0'}</td>\`;
          }).join('');
          return \`<tr><td style="font-size:18px;font-weight:800">\${m.major_name}</td>\${cells}<td style="text-align:center;font-size:19px;font-weight:800;color:#047857">\${m.total}</td></tr>\`;
        }).join('');

        const seasonalSubText = res.is_full_year_combined
          ? \`（❄️ 寒假 <strong>\${ts.winter_count || 0}</strong> 人次 ＋ ☀️ 暑假 <strong>\${ts.summer_count || 0}</strong> 人次） · \`
          : '';
        box.innerHTML = \`
          <div style="background:#faf5ff;border:2px solid #a855f7;border-radius:14px;padding:16px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
              <div>
                <div style="font-size:23px;font-weight:800;color:#4c1d95">
                  🏫 「\${res.agent_filter}」 · \${res.season_label} 报名费用核对单
                </div>
                <div style="font-size:20px;color:#1e293b;margin-top:6px">
                  共 <strong>\${ts.total_registrations}</strong> 人次 \${seasonalSubText}（器乐/声乐 <strong>\${ts.instrument_count}</strong> 人次 ＋ 音基 <strong>\${ts.theory_count}</strong> 人次）
                  ｜ 💰 应收考级费总额：<strong style="font-size:25px;color:#047857">¥\${(ts.total_fee_yuan || 0).toLocaleString()}</strong>
                </div>
                <div style="font-size:17px;color:#475569;margin-top:6px">
                  🎹 <strong>器乐各级别人数：</strong>\${instLvStr}<br/>
                  🎧 <strong>音基各级别人数：</strong>\${theoLvStr}
                </div>
              </div>
              <button class="btn-primary" style="font-size:20px;padding:14px 24px;border-radius:12px" onclick="copyTextUri('\${wechatBillCopy}')">
                📋 一键复制这份账单发微信给老师
              </button>
            </div>

            <div style="margin-top:14px;max-height:360px;overflow:auto;background:#fff;border-radius:10px;border:1px solid #e2e8f0">
              <table>
                <thead>
                  <tr style="font-size:17px"><th>序号</th><th>考生姓名</th><th>所属老师</th><th>报考专业</th><th>级别</th><th>报名费</th><th>证书1 (专业)</th><th>证书2 (音基)</th></tr>
                </thead>
                <tbody>\${studentRowsHtml || '<tr><td colspan="8" style="font-size:18px">该考期下未找到该老师的报名记录，可切换上方考期（如2025暑假）查看</td></tr>'}</tbody>
              </table>
            </div>
          </div>

          <div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:14px;padding:16px">
            <div style="font-size:21px;font-weight:800;color:#92400e;margin-bottom:8px">
              📑 附：《\${res.season_label}考前备案表 · 专业及考官信息》1–10级自动汇总表（全季总人数：\${res.filing_table?.season_grand_total || 0} 人次）
            </div>
            <div style="font-size:16px;color:#b45309;margin-bottom:10px">
              直接对应 <code>kjzx002120_江西九江_考前备案表.xlsx</code> 的「专业及考官信息」与「基本信息」总人数（含陶笛、音基）：
            </div>
            <div style="overflow-x:auto;background:#fff;border-radius:10px;border:1px solid #fde68a">
              <table>
                <thead>
                  <tr style="font-size:16px">
                    <th>专业名称</th>
                    <th style="text-align:center">1级</th><th style="text-align:center">2级</th><th style="text-align:center">3级</th><th style="text-align:center">4级</th><th style="text-align:center">5级</th>
                    <th style="text-align:center">6级</th><th style="text-align:center">7级</th><th style="text-align:center">8级</th><th style="text-align:center">9级</th><th style="text-align:center">10级</th>
                    <th style="text-align:center">合计</th>
                  </tr>
                </thead>
                <tbody>\${filingRowsHtml}</tbody>
              </table>
            </div>
          </div>
        \`;
      } catch (e) {
        box.innerHTML = '<div style="font-size:19px;color:red">统计加载失败: ' + e.message + '</div>';
      }
    }

    function switchTab(tab) {
      if (currentSession.role === 'parent' && (tab === 'teacher' || tab === 'console' || tab === 'mom')) {
        tab = 'parent';
      }
      if (currentSession.role === 'teacher' && (tab === 'console' || tab === 'mom')) {
        tab = 'teacher';
      }
      ['mom', 'parent', 'archive', 'teacher', 'console'].forEach(t => {
        document.getElementById('tab-' + t)?.classList.toggle('hidden', t !== tab);
        document.getElementById('nav-' + t)?.classList.toggle('active', t === tab);
      });
      refreshData();
      if (tab === 'mom') {
        momCheckWeChatSession();
        momStageCertOrPhoto();
        momLoadTeacherFeeReport();
        momLoadUploadLog();
      }
      if (tab === 'archive') searchHistoricalStudent('archive');
      if (tab === 'teacher') initTeacherTab();
      if (tab === 'console') {
        loadAdminArchiveStats();
        loadMediaCacheStats();
      }
    }

    function recalcParentCheckout() {
      const lvl = Number(document.getElementById('r-level')?.value || 6);
      const baseFee = LEVEL_FEES[lvl] || 390;
      const jointTheoryChecked = Boolean(document.getElementById('cb-joint-theory')?.checked);
      const theoryExamFee = jointTheoryChecked ? 200 : 0;

      const theoryPackCb = document.getElementById('cb-addon-theory-pack');
      const theoryPackLabel = document.getElementById('price-label-theory-pack');
      if (jointTheoryChecked && theoryPackCb) {
        theoryPackCb.checked = true;
        if (theoryPackLabel) theoryPackLabel.textContent = '¥0.00 (联报免单)';
      } else if (theoryPackLabel) {
        theoryPackLabel.textContent = '+¥19.90';
      }

      let addonFee = 0;
      let marketValue = 50; // Free cloud video archive worth ¥50/yr
      document.querySelectorAll('.p-addon-cb:checked').forEach(cb => {
        const isFreeTheoryPack = jointTheoryChecked && cb.value === 'music_theory_pack';
        addonFee += isFreeTheoryPack ? 0 : Number(cb.dataset.price || 0);
        marketValue += Number(cb.dataset.market || 0);
      });
      const savedYuan = Math.max(0, marketValue - addonFee);
      const total = baseFee + theoryExamFee + addonFee;
      const theoryPart = jointTheoryChecked ? \` + 联报音基1级 ¥200.00\` : '';
      document.getElementById('checkout-summary-text').textContent =
        \`\${lvl === 11 ? '演奏级' : lvl + '级'}官方费 ¥\${baseFee.toFixed(2)}\${theoryPart} + 在籍考生补贴包 ¥\${addonFee.toFixed(2)}（已享本办考生专属补贴立省 ¥\${savedYuan.toFixed(2)}）\`;
      document.getElementById('checkout-total-yuan').textContent = '¥' + total.toFixed(2);
    }

    async function searchHistoricalStudent(mode) {
      const inputId = mode === 'archive' ? 'archive-search-input' : 'quick-search-input';
      const targetId = mode === 'archive' ? 'archive-lookup-results' : 'parent-lookup-results';
      const q = document.getElementById(inputId)?.value.trim() || '';
      const box = document.getElementById(targetId);
      if (!box) return;
      box.innerHTML = '<div style="font-size:13px;color:var(--muted)">正在检索上海 PostgreSQL 历年考级档案库...</div>';

      const agentParam = currentSession.locked_agent?.agent_id
        ? '&agent_id=' + encodeURIComponent(currentSession.locked_agent.agent_id)
        : '';

      try {
        const res = await fetch('/official-sync/student-lookup?q=' + encodeURIComponent(q) + agentParam + '&limit=8');
        const data = await res.json();
        if (!data.items || data.items.length === 0) {
          box.innerHTML = '<div style="font-size:13px;color:var(--muted)">未找到本机构匹配的历年考生，请尝试清空关键词查看全部本机构学员，或直接下方新建档案。</div>';
          return;
        }

        if (mode === 'parent') {
          box.innerHTML = data.items.map(s => {
            const up = s.recommended_upgrade;
            const theoryGapBadge = s.missing_music_theory
              ? \` <span class="badge badge-needs_change">🔔 待补考《音乐基础知识 \${s.recommended_theory_level || 1}级》</span>\`
              : '';
            const upBadge = up
              ? \`上次考过：<strong>\${up.last_season} · \${up.major_name} \${up.last_level}级</strong> → 本季推荐直升 <span class="badge badge-upgrade">🎯 \${up.major_name} \${up.recommended_level}级 (¥\${up.official_fee_yuan})</span>\${theoryGapBadge}\`
              : '暂无往期记录';
            const payloadStr = encodeURIComponent(JSON.stringify(s));
            const picSrc = s.picture_url ? mediaProxyUrl(s.picture_url, 'photo', s.student_id, '') : '';
            return \`
              <div class="item-row" style="background:#fff;padding:10px 12px;border-radius:10px;border:1px solid #bbf7d0;margin-bottom:8px">
                <div style="display:flex;gap:12px;align-items:center">
                  \${picSrc ? \`<img src="\${picSrc}" style="width:46px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" />\` : ''}
                  <div>
                    <div style="font-size:14.5px"><strong>\${s.name_cn}</strong> <small style="color:var(--muted)">(\${s.sex || '女'} · 生日 \${s.birthday || '—'} · 手机 \${s.parent_phone_masked || '—'})</small></div>
                    <div style="font-size:12.5px;margin-top:3px">\${upBadge}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px">指导老师/报名点：<strong>\${s.agent_name || '本机构'}</strong> | 累计参考 \${s.all_exams} 次 | <span style="color:var(--primary-dark)">🎁 续报立享 ¥9.9 AI考官测评+免费云视频档案</span></div>
                  </div>
                </div>
                <button class="btn-primary btn-sm" onclick="autofillFromHistorical('\${payloadStr}')">⚡ 一键带入档案并直升下一级</button>
              </div>
            \`;
          }).join('');
        } else {
          box.innerHTML = data.items.map(s => {
            const examsHtml = (s.exams || []).map(e => {
              let titlesArr = [];
              let titles = '';
              try {
                const parsed = JSON.parse(e.exam_titles || '[]');
                titlesArr = Array.isArray(parsed) ? parsed.filter(Boolean) : [e.exam_titles];
                titles = titlesArr.join(' / ');
              } catch { titles = e.exam_titles || ''; }
              const videoKeys = e.videos_json ? Object.keys(e.videos_json) : [];
              const videoButtonsHtml = videoKeys.map((k, idx) => {
                const vObj = e.videos_json[k];
                if (!vObj || !vObj.url) return '';
                const pieceName = titlesArr[idx] || \`曲目\${idx + 1}\`;
                const encUrl = encodeURIComponent(vObj.url);
                const encTitle = encodeURIComponent(\`\${s.name_cn} · \${e.season_label} \${e.major_name}\${e.level}级 · 《\${pieceName}》\`);
                return \`<button class="btn-wecom btn-sm" onclick="playVideoLocally('\${encUrl}', '\${encTitle}', \${s.student_id}, \${e.exam_id})">🎬 本地播放曲目\${idx + 1}</button>\`;
              }).join('');
              const scoreHtml = e.score_total != null
                ? \`<div style="margin-top:4px;font-size:12px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;padding:4px 8px;border-radius:6px;display:inline-block">
                    🏆 <strong>考官五维评分：\${e.score_total}/50分</strong>
                    （音准 <strong>\${e.score_yinzhun ?? '—'}</strong> · 节奏 <strong>\${e.score_jiezou ?? '—'}</strong> · 音色 <strong>\${e.score_yinse ?? '—'}</strong> · 表现力 <strong>\${e.score_biaoxianli ?? '—'}</strong> · 完整性 <strong>\${e.score_wanzhengxing ?? '—'}</strong>）
                    \${e.pass_level ? \` · <span class="badge badge-confirmed">通过 \${e.pass_level}级</span>\` : ''}
                  </div>\`
                : (e.pass_level ? \`<div style="margin-top:4px"><span class="badge badge-confirmed">✅ 考官评定：通过 \${e.pass_level}级</span></div>\` : '');
              const reviewHtml = (e.self_review_text || e.review_text)
                ? \`<div style="margin-top:5px;font-size:12px;color:#334155;background:#fffbeb;border-left:3px solid #f59e0b;padding:5px 8px;border-radius:4px">
                    💬 <strong>国音考官评语：</strong>\${(e.self_review_text || e.review_text || '').replace(/\\n/g, '；')}
                  </div>\`
                : '';
              return \`
                <div style="padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid var(--border);margin-top:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <div style="flex:1;min-width:260px">
                    <span class="badge badge-locked">\${e.season_label}</span>
                    <strong style="margin-left:6px">\${e.major_name} · \${e.level}级</strong>
                    <span style="font-size:12px;color:var(--muted);margin-left:8px">准考证号: \${e.exam_no || '—'} | 备案批次: \${e.filing_code || '—'}</span>
                    \${titles ? \`<div style="font-size:12px;color:#475569;margin-top:3px">🎵 考试曲目：\${titles}</div>\` : ''}
                    \${scoreHtml}
                    \${reviewHtml}
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap">
                    \${videoButtonsHtml}
                  </div>
                </div>
              \`;
            }).join('');

            const picSrc = s.picture_url ? mediaProxyUrl(s.picture_url, 'photo', s.student_id, '') : '';
            return \`
              <div style="border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;background:#fff">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
                  <div style="display:flex;gap:14px;align-items:center">
                    \${picSrc ? \`<img src="\${picSrc}" style="width:52px;height:68px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />\` : ''}
                    <div>
                      <div style="font-size:16px;font-weight:700">\${s.name_cn} <span style="font-size:12px;font-weight:400;color:var(--muted)">(\${s.pinyin || ''} · 证件号 \${s.id_card_masked || ''})</span></div>
                      <div style="font-size:12.5px;color:var(--muted);margin-top:4px">所属机构/指导老师：<strong>\${s.agent_name || '—'}</strong> | 历史共参加国音考级 <strong>\${(s.exams || []).length}</strong> 次</div>
                    </div>
                  </div>
                  <button class="btn-primary btn-sm" onclick="prebufferStudentVideos(\${s.student_id}, '\${s.name_cn}')">📥 一键缓存该生全部视频到本地 MinIO</button>
                </div>
                <div style="margin-top:10px">\${examsHtml || '<div style="font-size:12px;color:var(--muted)">暂无关联考次</div>'}</div>
              </div>
            \`;
          }).join('');
        }
      } catch (err) {
        box.innerHTML = '<div style="color:var(--danger);font-size:13px">查询异常: ' + err.message + '</div>';
      }
    }

    async function autofillFromHistorical(encoded) {
      const s = JSON.parse(decodeURIComponent(encoded));
      document.getElementById('l-name').value = s.name_cn || '';
      document.getElementById('l-gender').value = s.sex === '男' ? '男' : '女';
      if (s.birthday && s.birthday.length === 8) {
        document.getElementById('l-dob').value = \`\${s.birthday.slice(0,4)}-\${s.birthday.slice(4,6)}-\${s.birthday.slice(6,8)}\`;
      }
      if (!currentSession.locked_agent && s.agent_name) {
        document.getElementById('r-teacher').value = s.agent_name;
      }
      if (s.recommended_upgrade) {
        const up = s.recommended_upgrade;
        const mappedSub = SUBJECT_MAP_CN_TO_ID[up.major_name] || 'piano';
        document.getElementById('r-subject').value = mappedSub;
        document.getElementById('r-level').value = String(up.recommended_level || 6);
      }
      const theoryBanner = document.getElementById('theory-joint-banner');
      const theoryCb = document.getElementById('cb-joint-theory');
      if (s.missing_music_theory && theoryBanner && theoryCb) {
        theoryBanner.style.display = 'block';
        const descEl = document.getElementById('theory-joint-desc');
        if (descEl) {
          descEl.textContent = \`系统检测到 \${s.name_cn} 已考过器乐等级，但尚未通过【音乐基础知识（音基）\${s.recommended_theory_level || 1}级】（高阶考级/领证必备）。勾选联报立享 ¥9.90 音基题库免费送！\`;
        }
        theoryCb.checked = true;
      } else if (theoryBanner && theoryCb) {
        theoryBanner.style.display = 'none';
        theoryCb.checked = false;
      }
      recalcParentCheckout();
      await createLearner();
      showToast(\`✅ 已自动带入「\${s.name_cn}」历史档案，并为您自动匹配直升「\${s.recommended_upgrade?.major_name || ''} \${s.recommended_upgrade?.recommended_level || ''}级」！\`);
    }

    async function runAiIdPhotoPolish() {
      const nameCn = document.getElementById('l-name').value.trim() || '测试陈小乐';
      const idNum = document.getElementById('l-idnum').value.trim() || '9901';
      const res = await fetch('/value-added/id-photo-polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_cn: nameCn, id_number_or_last4: idNum.slice(-4), backdrop_color: 'white' })
      }).then(r => r.json());
      document.getElementById('photo-polish-status').innerHTML =
        \`<strong style="color:var(--primary-dark)">✅ 合规通过：</strong> 已生成 <code>\${res.standard_filename}</code> (\${res.target_spec.width_px}×\${res.target_spec.height_px}px 标准白底)\`;
      showToast('✨ AI 二寸标准照换底与 413×626px 合规裁剪完成！');
    }

    async function refreshData() {
      const [lRes, rRes, aRes] = await Promise.all([
        fetch('/learners').then(r => r.json()),
        fetch('/registrations').then(r => r.json()),
        fetch('/archives').then(r => r.json()),
      ]);

      const learners = lRes.items || [];
      const regs = rRes.items || [];
      const archives = aRes.items || [];

      const learnerOpts = learners.map(l => \`<option value="\${l.id}">\${l.name_cn} (*\${l.id_last4})</option>\`).join('');
      if (document.getElementById('r-learner')) document.getElementById('r-learner').innerHTML = learnerOpts || '<option value="">请先上方保存或检索带入学员</option>';
      if (document.getElementById('a-learner')) document.getElementById('a-learner').innerHTML = learnerOpts || '<option value="">请先创建学员</option>';

      const learnerMap = Object.fromEntries(learners.map(l => [l.id, l]));

      document.getElementById('parent-reg-list').innerHTML = regs.length === 0
        ? '<p style="font-size:13px;color:var(--muted)">暂无报名记录</p>'
        : regs.map(r => \`
          <div class="item-row">
            <div>
              <strong>\${learnerMap[r.learner_id]?.name_cn || r.learner_id}</strong>
              — \${r.subject_id} · \${r.level}级 (\${r.cycle_id})
              <div style="font-size:12px;color:var(--muted)">曲目：\${(r.repertoire || []).join(' / ') || '未填'} | 指导老师：\${r.teacher_id || '本机构'}</div>
            </div>
            <span class="badge badge-\${r.status}">\${r.status}</span>
          </div>
        \`).join('');

      document.getElementById('console-reg-list').innerHTML = regs.length === 0
        ? '<p style="font-size:13px;color:var(--muted)">暂无待处理报名单（可在「我要报名」或「合作老师专席」一键生成升班报名单）</p>'
        : regs.map(r => \`
          <div class="item-row">
            <div>
              <strong>\${learnerMap[r.learner_id]?.name_cn || r.learner_id}</strong>
              <span class="badge badge-\${r.status}">\${r.status}</span>
              <div style="font-size:12px;color:var(--muted)">\${r.cycle_id} · \${r.subject_id} \${r.level}级 · 指导老师：\${r.teacher_id || '—'} · 曲目：\${(r.repertoire || []).join(' / ')}</div>
            </div>
            <div style="display:flex;gap:6px">
              \${r.status !== 'locked' ? \`<button class="btn-primary btn-sm" onclick="lockReg('\${r.id}')">⚡ 一键确认并锁定 (自动计提优待金)</button>\` : ''}
              \${r.status === 'submitted' ? \`<button class="btn-warn btn-sm" onclick="returnReg('\${r.id}')">退回修改</button>\` : ''}
            </div>
          </div>
        \`).join('');

      document.getElementById('archive-list').innerHTML = archives.length === 0
        ? ''
        : archives.map(a => \`
          <div class="item-row">
            <div>
              <strong>\${learnerMap[a.learner_id]?.name_cn || a.learner_id}</strong>
              — \${a.subject_id} \${a.level}级 · 成绩：<strong>\${a.result}</strong>
              <div style="font-size:12px;color:var(--muted)">证书编号：\${a.certificate_no || '—'}</div>
            </div>
          </div>
        \`).join('');
    }

    async function createLearner() {
      const payload = {
        name_cn: document.getElementById('l-name').value.trim() || '测试陈小乐',
        gender: document.getElementById('l-gender').value,
        dob: document.getElementById('l-dob').value,
        id_type: document.getElementById('l-idtype').value,
        id_number: document.getElementById('l-idnum').value.trim() || '360402201605129901',
        guardian_phone: document.getElementById('l-phone').value.trim() || '13800139901',
      };
      const res = await fetch('/learners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast('学员档案已加密保存');
        await refreshData();
      }
    }

    async function createAndSubmitRegistration() {
      let learnerId = document.getElementById('r-learner').value;
      if (!learnerId) {
        await createLearner();
        const lRes = await fetch('/learners').then(r => r.json());
        learnerId = lRes.items?.[lRes.items.length - 1]?.id;
      }
      if (!learnerId) return showToast('请先保存学员档案');

      const repRaw = document.getElementById('r-rep1').value || '';
      const repertoire = repRaw.split(/[,，/]/).map(s => s.trim()).filter(Boolean);
      const teacherId = document.getElementById('r-teacher').value.trim() || 'tch_zhang';
      const addonIds = Array.from(document.querySelectorAll('.p-addon-cb:checked')).map(cb => cb.value);

      const createRes = await fetch('/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id: learnerId,
          teacher_id: teacherId,
          cycle_id: document.getElementById('r-cycle').value,
          subject_id: document.getElementById('r-subject').value,
          level: Number(document.getElementById('r-level').value),
          repertoire,
        }),
      });
      const reg = await createRes.json();

      const chkRes = await fetch('/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_id: reg.id,
          teacher_id: teacherId,
          addon_ids: addonIds,
        }),
      }).then(r => r.json());

      if (chkRes.order?.id) {
        await fetch(\`/payments/orders/\${chkRes.order.id}/pay\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wx_transaction_id: 'wx_live_' + Date.now() }),
        });
      }

      await fetch(\`/registrations/\${reg.id}/status\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_status: 'submitted' }),
      });

      showToast(\`🎉 微信支付成功 (\${chkRes.pricing?.total_payable_yuan || ''})！已提交指导老师审核\`);
      refreshData();
    }

    async function lockReg(id) {
      await fetch(\`/registrations/\${id}/status\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_status: 'locked', teacher_notes: '一键确认并锁定' }),
      });
      showToast('⚡ 已一键锁定报名快照，并自动计提指导老师优待金！');
      refreshData();
    }

    async function returnReg(id) {
      await fetch(\`/registrations/\${id}/status\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_status: 'needs_change', teacher_notes: '请核对曲目信息' }),
      });
      showToast('已退回家长修改');
      refreshData();
    }

    async function createArchive() {
      const learnerId = document.getElementById('a-learner').value;
      if (!learnerId) return showToast('请先选择学员');
      await fetch('/archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learner_id: learnerId,
          cycle_id: '2025-summer',
          subject_id: document.getElementById('a-subject').value,
          level: Number(document.getElementById('a-level').value),
          result: document.getElementById('a-result').value,
          certificate_no: document.getElementById('a-cert').value,
        }),
      });
      showToast('考级档案已保存');
      refreshData();
    }

    async function exportAllLocked(format) {
      const rRes = await fetch('/registrations?status=locked').then(r => r.json());
      let lockedIds = (rRes.items || []).map(r => r.id);
      if (lockedIds.length === 0) {
        return showToast('当前没有已锁定 (locked) 的本期报名单，请先在列表点击「一键确认并锁定」');
      }
      const expRes = await fetch('/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycle_id: '2025-summer', registration_ids: lockedIds }),
      });
      const job = await expRes.json();
      window.open(format === 'zip' ? job.zip_download_url : job.download_url, '_blank');
    }

    // Teacher Tab: Load Partner Agents + Filtered Upgrade Radar + Concession Wallet
    let partnerAgentsList = [];
    async function initTeacherTab() {
      if (partnerAgentsList.length === 0) {
        const res = await fetch('/official-sync/partner-agents').then(r => r.json());
        partnerAgentsList = res.items || [];
        const sel = document.getElementById('teacher-agent-select');
        const allOpt = \`<option value="">🌐 全部合作机构汇总</option>\`;
        const opts = partnerAgentsList.slice(0, 80).map(a =>
          \`<option value="\${a.agent_id}">[\${a.code || a.agent_id}] \${a.name} (负责人: \${a.manager || '—'} · 历年 \${a.total_exams} 考次 / \${a.distinct_students} 人)</option>\`
        ).join('');
        sel.innerHTML = allOpt + opts;
      }

      if (currentSession.locked_agent) {
        document.getElementById('teacher-agent-select').value = String(currentSession.locked_agent.agent_id);
        document.getElementById('teacher-selector-row').classList.add('hidden');
        updateTeacherBindCard(currentSession.locked_agent);
      } else {
        document.getElementById('teacher-selector-row').classList.remove('hidden');
        if (!document.getElementById('teacher-agent-select').value) {
          document.getElementById('teacher-agent-select').value = '999';
        }
        const selected = partnerAgentsList.find(a => String(a.agent_id) === document.getElementById('teacher-agent-select').value);
        if (selected) updateTeacherBindCard(selected);
      }
      await loadTeacherRadarAndWallet();
    }

    function updateTeacherBindCard(agent) {
      if (!agent) return;
      document.getElementById('t-bind-header-title').textContent =
        \`🔗 [\${agent.code || agent.agent_id}] \${agent.name} (\${agent.manager || ''}) · 微信绑定与家长推广码\`;
      document.getElementById('t-parent-ref-url').value =
        \`\${location.origin}/app?ref=\${agent.parent_referral_code || ('ref_' + agent.agent_id)}&tab=parent\`;
      const badge = document.getElementById('t-bind-status-badge');
      if (agent.wx_openid) {
        badge.style.background = '#d1fae5';
        badge.style.color = '#065f46';
        badge.textContent = \`🟢 已绑定微信: \${agent.wx_nickname || '实名老师'} (\${agent.wx_openid.slice(0,10)}...)\`;
      } else {
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
        badge.textContent = '⏳ 待绑定老师微信号 (首次点击下方按钮即可绑定)';
      }
    }

    async function bindCurrentTeacherWeChat(unbind) {
      const agentId = currentSession.locked_agent?.agent_id || Number(document.getElementById('teacher-agent-select').value || 999);
      const nick = document.getElementById('t-wx-nickname-input').value.trim() || '张老师 (微信实名)';
      const res = await fetch('/official-sync/bind-teacher-wechat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          wx_nickname: nick,
          unbind: Boolean(unbind)
        })
      }).then(r => r.json());

      if (res.agent) {
        if (currentSession.locked_agent) currentSession.locked_agent = res.agent;
        const idx = partnerAgentsList.findIndex(a => a.agent_id === res.agent.agent_id);
        if (idx >= 0) partnerAgentsList[idx] = { ...partnerAgentsList[idx], ...res.agent };
        updateTeacherBindCard(res.agent);
        showToast(unbind ? '已解绑该老师的微信 OpenID' : \`🎉 已成功将微信号「\${nick}」绑定至 [\${res.agent.name}]！\`);
      }
    }

    function copyParentReferralLink() {
      const url = document.getElementById('t-parent-ref-url').value;
      navigator.clipboard.writeText(url).then(() => {
        showToast('✅ 已复制本琴行家长专属报名链接！家长打开后将自动锁定本琴行并隐藏其它机构。');
      });
    }

    async function loadTeacherRadarAndWallet() {
      const agentId = currentSession.locked_agent?.agent_id || document.getElementById('teacher-agent-select')?.value || '';
      const selected = partnerAgentsList.find(a => String(a.agent_id) === String(agentId));
      if (selected) updateTeacherBindCard(selected);

      const q = agentId ? \`?agent_id=\${agentId}&limit=25\` : '?limit=25';
      const [radar, wallet] = await Promise.all([
        fetch('/official-sync/archive-upgrade-radar' + q).then(r => r.json()),
        fetch('/teachers/tch_zhang/concessions').then(r => r.json())
      ]);

      document.getElementById('t-radar-count').textContent = (radar.total_candidates || 0) + ' 人';
      document.getElementById('t-radar-fee').textContent = radar.total_expected_exam_fee_yuan || '¥0.00';
      document.getElementById('t-radar-conc').textContent = radar.total_expected_concession_yuan || '¥0.00';
      document.getElementById('t-wallet-avail').textContent = wallet.wallet?.confirmed_available_yuan || '¥0.00';

      const tbody = document.getElementById('teacher-radar-tbody');
      if (!radar.sample_candidates || radar.sample_candidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">该机构暂无 2025 未续报考生</td></tr>';
      } else {
        tbody.innerHTML = radar.sample_candidates.map(c => {
          const safeMsg = encodeURIComponent(c.wechat_template_preview || '');
          const safeStudent = encodeURIComponent(JSON.stringify(c));
          return \`
            <tr>
              <td><strong>\${c.student_name}</strong> (<code>\${c.parent_phone || '—'}</code>)<br><span style="font-size:11px;color:var(--muted)">指导老师：\${c.agent_name || '本机构'}</span></td>
              <td>\${c.last_season} · \${c.major_name} \${c.last_level}级</td>
              <td><span class="badge badge-upgrade">🎯 \${c.major_name} \${c.recommended_level}级</span></td>
              <td>收 <strong>¥\${c.expected_exam_fee_yuan}</strong> / 优待金 <strong style="color:var(--primary-dark)">\${c.expected_concession_yuan}</strong></td>
              <td style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn-outline btn-sm" onclick="copyTextUri('\${safeMsg}')">📋 复制微信话术</button>
                <button class="btn-primary btn-sm" onclick="quickCreateFromRadar('\${safeStudent}')">⚡ 代建升班单</button>
              </td>
            </tr>
          \`;
        }).join('');
      }

      document.getElementById('teacher-wallet-detail').innerHTML = \`
        <div style="font-size:13px;color:var(--muted);margin-bottom:8px">
          待考级办确认：<strong>\${wallet.wallet?.accrued_pending_yuan || '¥0.00'}</strong> |
          可提现余额：<strong style="color:var(--primary-dark)">\${wallet.wallet?.confirmed_available_yuan || '¥0.00'}</strong> |
          已累计提现：<strong>\${wallet.wallet?.withdrawn_paid_yuan || '¥0.00'}</strong>
        </div>
      \`;
    }

    function copyTextUri(encoded) {
      const txt = decodeURIComponent(encoded);
      navigator.clipboard.writeText(txt).then(() => {
        showToast('✅ 已复制内容，可直接粘贴发送！');
      });
    }

    async function quickCreateFromRadar(encoded) {
      const c = JSON.parse(decodeURIComponent(encoded));
      switchTab('parent');
      document.getElementById('l-name').value = c.student_name || '';
      document.getElementById('r-teacher').value = c.agent_name || 'tch_zhang';
      document.getElementById('r-subject').value = SUBJECT_MAP_CN_TO_ID[c.major_name] || 'piano';
      document.getElementById('r-level').value = String(c.recommended_level || 6);
      recalcParentCheckout();
      await createLearner();
      showToast(\`⚡ 已为「\${c.student_name}」自动填好「\${c.major_name} \${c.recommended_level}级 (¥\${c.expected_exam_fee_yuan})」报名单！\`);
    }

    async function requestTeacherWithdrawal() {
      const res = await fetch('/teachers/tch_zhang/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_note: '老师工作台一键申请提现' })
      });
      if (!res.ok) {
        return showToast('当前暂无已由考级办确认的可提现优待金余额');
      }
      showToast('💸 提现申请已提交考级办财务打款！');
      loadTeacherRadarAndWallet();
    }

    // Admin Console: Live Archive Stats & Teacher Invite Table
    async function loadAdminArchiveStats() {
      try {
        const [data, agentsRes, intelRes] = await Promise.all([
          fetch('/official-sync/archive-stats').then(r => r.json()),
          fetch('/official-sync/partner-agents').then(r => r.json()),
          fetch('/official-sync/studio-growth-intelligence').then(r => r.json()).catch(() => null)
        ]);
        if (data.totals) {
          document.getElementById('adm-stat-students').textContent = data.totals.historical_students_count.toLocaleString() + ' 人';
          document.getElementById('adm-stat-exams').textContent = data.totals.historical_exams_count.toLocaleString() + ' 笔';
          document.getElementById('adm-stat-agents').textContent = data.totals.partner_agents_count + ' 家';
        }

        // Render Studio Growth & Churn Forensic Radar
        const intelBox = document.getElementById('adm-studio-intelligence-box');
        if (intelBox && intelRes) {
          const gap = intelRes.theory_cross_sell_gap || {};
          const defectors = (intelRes.channel_defectors_bucket_b || []).slice(0, 8).map(s => {
            const studioName = s.name || s.agent_name || '合作老师';
            const retPct = s.ret24_pct ?? s.retention_pct ?? 0;
            const lvStart = s.avg_lvl_22 ?? s.avg_lv_2023 ?? '—';
            const lvEnd = s.avg_lvl_25 ?? s.avg_lv_2025 ?? '—';
            const tUrl = \`\${location.origin}/app?invite=\${s.invite_token || ''}&tab=teacher\`;
            const pitch = encodeURIComponent(\`【国音九江考级办·核心合作机构专享】\${studioName}老师您好！本季我们为您的在籍考生开放了5项低于市面价80%的官方补贴权益（¥1.90 AI二寸照、¥9.90 国音考官五维测评+同曲目百分位排名报告、¥0 免费永久保存2020-2026历年考级高清视频档案），且满30人即享阶梯优待金加码。点击您的专属工作台一键生成老生续报清单：\${tUrl}\`);
            return \`<tr>
              <td><strong>\${studioName}</strong> <small style="color:var(--muted)">(\${s.main_inst || ''})</small></td>
              <td>\${s.y2023} → \${s.y2024} → <strong style="color:var(--danger)">\${s.y2025}</strong></td>
              <td><span class="badge" style="background:#fef2f2;color:#991b1b">\${retPct}% (流失\${s.lost_since_2023 || 0}人)</span></td>
              <td>\${lvStart}级 → <strong>\${lvEnd}级</strong></td>
              <td><button class="btn-purple btn-sm" onclick="copyTextUri('\${pitch}')">📋 复制挽回话术(专属低价权益包)</button></td>
            </tr>\`;
          }).join('');
          const loyalAging = (intelRes.loyal_aging_bucket_a || []).slice(0, 8).map(s => {
            const studioName = s.name || s.agent_name || '合作老师';
            const retPct = s.ret24_pct ?? s.retention_pct ?? 0;
            const lvStart = s.avg_lvl_22 ?? s.avg_lv_2023 ?? '—';
            const lvEnd = s.avg_lvl_25 ?? s.avg_lv_2025 ?? '—';
            const tUrl = \`\${location.origin}/app?invite=\${s.invite_token || ''}&tab=teacher\`;
            const pitch = encodeURIComponent(\`【国音九江考级办·琴行春季招生赋能】\${studioName}老师您好！感谢您一直以来的支持（老生续报率高达 \${retPct}%）！为帮咱们琴行补充1-3级启蒙新生，考级办免费为您提供【AI国音考官五维模拟测评体验卡】供琴行做引流体验课，并在您名下考生的考级荣誉海报底部免费印制贵琴行招生二维码！工作台：\${tUrl}\`);
            return \`<tr>
              <td><strong>\${studioName}</strong> <small style="color:var(--muted)">(\${s.main_inst || ''})</small></td>
              <td>\${s.y2023} → \${s.y2024} → <strong>\${s.y2025}</strong></td>
              <td><span class="badge badge-confirmed">\${retPct}% 极高忠诚</span></td>
              <td>\${lvStart}级 → <strong style="color:var(--warn)">\${lvEnd}级 (高龄化)</strong></td>
              <td><button class="btn-outline btn-sm" onclick="copyTextUri('\${pitch}')">🎁 复制招生赋能包话术</button></td>
            </tr>\`;
          }).join('');
          intelBox.innerHTML = \`
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div style="font-size:12.5px;color:#1e3a8a">
                💡 <strong>「音乐基础知识（音基）」跨科联报金矿：</strong>库内共 <strong>\${(gap.grade3plus_missing_theory || 2439).toLocaleString()} 名</strong> 器乐3级以上考生（含 <strong>\${(gap.grade6plus_missing_theory || 1027).toLocaleString()} 名</strong> 6级以上高阶考生）从未报考音基！家长端搜索老生时已开启<strong>自动弹窗勾选「音基联报 + 免费送 ¥9.90 冲刺题库」</strong>。
              </div>
              <span class="badge badge-paid">潜在新增考费池 ¥58.5万</span>
            </div>
            <div class="grid-2" style="gap:14px">
              <div style="border:1px solid #fecaca;background:#fff5f5;border-radius:10px;padding:10px">
                <div style="font-size:13px;font-weight:700;color:#991b1b;margin-bottom:6px">🚨 Bucket B：疑似外流其它考级通道机构（老生续报率 &lt;35%，低级别被转走）</div>
                <div style="font-size:11.5px;color:#7f1d1d;margin-bottom:8px">对策：用<strong>「仅限本考点在籍考生专享低于市面价80%补贴包 + 历年视频云档案绑定 + 阶梯返佣」</strong>让家长主动要求报国音。</div>
                <table>
                  <thead><tr><th>机构/老师</th><th>23→24→25考次</th><th>1-8级老生续报率</th><th>平均考级变化</th><th>精准挽回</th></tr></thead>
                  <tbody>\${defectors}</tbody>
                </table>
              </div>
              <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:10px">
                <div style="font-size:13px;font-weight:700;color:#065f46;margin-bottom:6px">🌱 Bucket A：100%忠诚但琴行初学新生断档机构（老生续报 50%~88%，均级升至 7.5+级）</div>
                <div style="font-size:11.5px;color:#065f46;margin-bottom:8px">对策：老生毕业致总量自然下滑，提供<strong>「AI五维测评引流卡 + 考级喜报底部琴行招生码」</strong>帮老师招1-3级新生。</div>
                <table>
                  <thead><tr><th>机构/老师</th><th>23→24→25考次</th><th>1-8级老生续报率</th><th>平均考级变化</th><th>招生赋能</th></tr></thead>
                  <tbody>\${loyalAging}</tbody>
                </table>
              </div>
            </div>
          \`;
        }

        // Populate top 12 teachers in invite table (starting with 999 sandbox teacher)
        const inviteRows = (agentsRes.items || []).slice(0, 12).map(a => {
          const tUrl = \`\${location.origin}/app?invite=\${a.invite_token}&tab=teacher\`;
          const pUrl = \`\${location.origin}/app?ref=\${a.parent_referral_code}&tab=parent\`;
          const inviteMsg = encodeURIComponent(\`【中国音乐学院九江考级办】\${a.manager || a.name}老师您好！您的机构「\${a.name}」专属考级工作台已开通（含名下历年考生档案、2026待升班提醒与优待金提现账本）。请点击您的专属链接一键绑定微信：\${tUrl}\`);
          const bindBadge = a.wx_openid
            ? \`<span class="badge badge-confirmed">🟢 已绑: \${a.wx_nickname || a.wx_openid.slice(0,8)}</span>\`
            : \`<span class="badge badge-draft">未绑定</span>\`;
          return \`
            <tr style="\${a.agent_id === 999 ? 'background:#f0fdf4' : ''}">
              <td><code>[\${a.code || a.agent_id}]</code> <strong>\${a.name}</strong></td>
              <td>\${a.manager || '—'} <small style="color:var(--muted)">(\${a.total_exams}考次/\${a.distinct_students}人)</small></td>
              <td>\${bindBadge}</td>
              <td>
                <button class="btn-purple btn-sm" onclick="copyTextUri('\${inviteMsg}')">📋 复制老师绑定邀请函</button>
                <a href="\${tUrl}" style="margin-left:4px;font-size:12px">直接进入</a>
              </td>
              <td>
                <button class="btn-outline btn-sm" onclick="copyTextUri('\${encodeURIComponent(pUrl)}')">📲 复制家长报名链接</button>
                <a href="\${pUrl}" style="margin-left:4px;font-size:12px">预览</a>
              </td>
            </tr>
          \`;
        }).join('');
        document.getElementById('adm-invite-tbody').innerHTML = inviteRows;

        const annualHtml = (data.annual_combined || []).map(a => {
          const yoyBadge = a.yoy_pct == null
            ? '<span style="color:var(--muted)">基期</span>'
            : a.yoy_pct >= 0
              ? \`<span class="badge badge-confirmed">+\${a.yoy_pct}%</span>\`
              : \`<span class="badge" style="background:#fef2f2;color:#991b1b">\${a.yoy_pct}%</span>\`;
          return \`<tr>
            <td><strong>\${a.year}全年</strong></td>
            <td><strong style="color:var(--primary-dark)">\${Number(a.full_year_count || 0).toLocaleString()}</strong> 笔</td>
            <td>❄️ \${Number(a.winter_count || 0).toLocaleString()} ＋ ☀️ <strong>\${Number(a.summer_count || 0).toLocaleString()}</strong> <small style="color:var(--muted)">(暑占 \${a.summer_share_pct}%)</small></td>
            <td>\${yoyBadge}</td>
          </tr>\`;
        }).join('');
        const seasonsHtml = (data.seasons || []).map(s =>
          \`<tr><td><code>\${s.season_code}</code> · \${s.season_label}</td><td><strong>\${s.exam_count.toLocaleString()}</strong> 笔</td></tr>\`
        ).join('');
        const agentsHtml = (data.top_partner_agents || []).slice(0, 10).map(a =>
          \`<tr><td>[\${a.code}] <strong>\${a.name}</strong> (\${a.manager || ''})</td><td><strong>\${a.total_exams}</strong> 考次 / \${a.distinct_students} 人</td></tr>\`
        ).join('');
        document.getElementById('adm-archive-breakdown').innerHTML = \`
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">📆 2020–2026 全年合并（寒假+暑假 · 消除季节性）</h3>
            <table><thead><tr><th>年度</th><th>全年合计</th><th>寒假 + 暑假 (季节性占比)</th><th>同比</th></tr></thead><tbody>\${annualHtml}</tbody></table>
          </div>
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">📅 13 个单考期明细</h3>
            <table><thead><tr><th>考期</th><th>报考笔数</th></tr></thead><tbody>\${seasonsHtml}</tbody></table>
          </div>
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">🏆 Top 10 合作老师 / 报名点</h3>
            <table><thead><tr><th>机构 / 指导老师</th><th>累计考次 / 考生数</th></tr></thead><tbody>\${agentsHtml}</tbody></table>
          </div>
        \`;
      } catch (err) {
        console.error(err);
      }
    }

    let admPollTimer = null;
    async function openQrSyncModal() {
      const drawer = document.getElementById('qr-sync-drawer');
      drawer.classList.remove('hidden');
      if (admPollTimer) clearInterval(admPollTimer);
      const res = await fetch('/official-sync/qr-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(r => r.json());

      document.getElementById('adm-qr-sess').textContent = res.php_sess_id || '—';
      document.getElementById('adm-qr-token').textContent = res.wxauth_token || '—';
      if (res.qr_image_base64) {
        document.getElementById('adm-qr-img').innerHTML = \`<img src="\${res.qr_image_base64}" style="width:100%;height:100%;object-fit:contain" />\`;
      }
      admPollTimer = setInterval(async () => {
        const p = await fetch('/official-sync/wxauth-poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ php_sess_id: res.php_sess_id, wxauth_token: res.wxauth_token })
        }).then(r => r.json());
        if (p.authenticated) {
          clearInterval(admPollTimer);
          document.getElementById('adm-qr-status').textContent = '🟢 扫码确认成功！已接管官网会话';
          showToast('🎉 考级办官网扫码确认成功！');
        }
      }, 2000);
    }

    // Authorized 3-Person WeChat OpenID Gate (余绍立, 杜薇, 谈老师 only)
    let gatePollTimer = null;
    async function initFamilyAuthGate() {
      const params = new URLSearchParams(location.search);
      const invite = params.get('invite') || params.get('invite_token') || '';
      const ref = params.get('ref') || params.get('ref_agent') || '';
      const savedToken = localStorage.getItem('mea_family_token') || '';

      // Teacher/parent scoped invite links have their own strict single-agent isolation
      if (invite || ref) {
        document.getElementById('mea-auth-gate')?.classList.add('hidden');
        return true;
      }

      try {
        const res = await fetch('/official-sync/family-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: savedToken })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.family_token) localStorage.setItem('mea_family_token', data.family_token);
          if (data.operator && !localStorage.getItem('mea_operator_name')) {
            localStorage.setItem('mea_operator_name', data.operator);
          }
          document.getElementById('mea-auth-gate')?.classList.add('hidden');
          return true;
        }
      } catch {}

      // Show full-screen login gate and start 3-person WeChat QR verification
      const gate = document.getElementById('mea-auth-gate');
      if (gate) {
        gate.classList.remove('hidden');
        startGateWeChatQr();
      }
      return false;
    }

    async function startGateWeChatQr() {
      const box = document.getElementById('gate-wx-qr-box');
      const status = document.getElementById('gate-wx-qr-status');
      if (!box || !status) return;
      box.innerHTML = '正在加载授权微信二维码...';
      try {
        const res = await fetch('/official-sync/qr-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }).then(r => r.json());
        if (res.qr_image_base64) {
          box.innerHTML = \`<img src="\${res.qr_image_base64}" style="width:100%;height:100%;object-fit:contain;border-radius:10px" />\`;
          status.textContent = '📱 请使用已授权微信扫码（手机端长按二维码点「识别图中二维码」即可）';
          if (gatePollTimer) clearInterval(gatePollTimer);
          gatePollTimer = setInterval(async () => {
            try {
              const p = await fetch('/official-sync/wxauth-poll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ php_sess_id: res.php_sess_id, wxauth_token: res.wxauth_token })
              }).then(r => r.json());
              if (p.authenticated) {
                clearInterval(gatePollTimer);
                if (p.family_token) localStorage.setItem('mea_family_token', p.family_token);
                if (p.operator_label) localStorage.setItem('mea_operator_name', p.operator_label);
                localStorage.setItem('mea_default_tab', 'mom');
                document.getElementById('mea-auth-gate')?.classList.add('hidden');
                showToast(\`✅ 微信核验成功：\${p.operator_label || '已授权管理员'}！已自动记住本机\`);
                location.reload();
              } else if (p.error === 'UNAUTHORIZED_WECHAT_OPENID') {
                clearInterval(gatePollTimer);
                status.style.color = '#dc2626';
                status.textContent = '⛔ ' + (p.message || '该微信号未授权登录');
              } else if (p.scan_status === 2) {
                status.textContent = '📲 已扫码！请在手机微信上点击「确认登录」...';
              }
            } catch {}
          }, 2000);
        }
      } catch {
        box.innerHTML = '二维码加载失败，请点下方按钮刷新';
      }
    }

    // Bootstrap Session Role & Isolation from URL parameters
    (async function bootstrapSession() {
      const authed = await initFamilyAuthGate();
      if (!authed) return;

      const params = new URLSearchParams(location.search);
      const invite = params.get('invite') || params.get('invite_token') || '';
      const ref = params.get('ref') || params.get('ref_agent') || '';
      const roleParam = params.get('role') || '';
      let initialTab = params.get('tab') || '';

      try {
        const q = new URLSearchParams();
        if (invite) q.set('invite_token', invite);
        if (ref) q.set('ref', ref);
        if (roleParam) q.set('role', roleParam);
        const sess = await fetch('/official-sync/resolve-session?' + q.toString()).then(r => r.json());
        currentSession = sess;
      } catch {
        // fallback to admin
      }

      const pill = document.getElementById('role-identity-pill');
      if (currentSession.role === 'teacher' && currentSession.locked_agent) {
        const a = currentSession.locked_agent;
        pill.textContent = \`👩‍🏫 合作老师专席：\${a.name} (\${a.manager || ''})\`;
        document.getElementById('nav-console').classList.add('hidden');
        document.getElementById('r-teacher').value = a.name;
        document.getElementById('r-teacher').readOnly = true;
        document.getElementById('t-isolation-badge').textContent = \`🔒 已锁定本机构 [\${a.code || a.agent_id}] \${a.name} (其它机构不可见)\`;
        if (a.agent_id === 999) document.getElementById('chip-t999')?.classList.add('active');
        if (a.agent_id === 68) document.getElementById('chip-t068')?.classList.add('active');
        if (!initialTab) initialTab = 'teacher';
      } else if (currentSession.role === 'parent') {
        const a = currentSession.locked_agent;
        pill.textContent = a ? \`👨‍👩‍👧 家长报名通道 (归属：\${a.name})\` : '👨‍👩‍👧 家长报名通道';
        document.getElementById('nav-teacher').classList.add('hidden');
        document.getElementById('nav-console').classList.add('hidden');
        if (a) {
          document.getElementById('parent-ref-banner').classList.remove('hidden');
          document.getElementById('parent-ref-teacher-name').textContent = \`[\${a.code || a.agent_id}] \${a.name} (\${a.manager || '指导老师'})\`;
          document.getElementById('r-teacher').value = a.name;
          document.getElementById('r-teacher').readOnly = true;
          if (a.agent_id === 999) {
            document.getElementById('chip-p999')?.classList.add('active');
            document.getElementById('quick-search-input').value = '测试';
          }
          if (a.agent_id === 68) {
            document.getElementById('chip-p068')?.classList.add('active');
            document.getElementById('quick-search-input').value = '李仕泓';
          }
        }
        if (!initialTab) initialTab = 'parent';
      } else {
        pill.textContent = '👑 考级办管理员总控视角 (全权限)';
        document.getElementById('chip-admin')?.classList.add('active');
        if (!initialTab) initialTab = 'parent';
      }

      const modeParam = params.get('mode') || '';
      if (modeParam === 'mom') initialTab = 'mom';
      if (!params.get('tab') && !invite && !ref && !roleParam && localStorage.getItem('mea_default_tab') === 'mom') {
        initialTab = 'mom';
      }
      if (initialTab === 'mom') {
        document.getElementById('chip-admin')?.classList.remove('active');
        document.getElementById('chip-mom')?.classList.add('active');
        const savedOp = localStorage.getItem('mea_operator_name');
        if (savedOp) {
          pill.textContent = \`👵 \${savedOp} · 专属微信大字台\`;
        }
      }

      recalcParentCheckout();
      switchTab(['mom', 'parent', 'archive', 'teacher', 'console'].includes(initialTab) ? initialTab : 'parent');
      searchHistoricalStudent('parent');
    })();
  </script>

  <!-- FULL-SCREEN AUTHORIZED WECHAT ID GATE OVERLAY -->
  <div id="mea-auth-gate" style="position:fixed;inset:0;z-index:9999;background:#0f172a;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto">
    <div style="background:#ffffff;max-width:460px;width:100%;border-radius:20px;padding:28px 22px;box-shadow:0 20px 50px rgba(0,0,0,0.5);text-align:center;border:3px solid #16a34a">
      <div style="font-size:24px;font-weight:800;color:#065f46;margin-bottom:14px">
        🔒 内部工作台 · 微信扫码登录
      </div>
      <div id="gate-wx-qr-box" style="width:236px;height:236px;margin:0 auto 12px;border:3px solid #86efac;border-radius:14px;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-size:16px;color:#047857;padding:8px">
        正在加载微信核验码...
      </div>
      <div id="gate-wx-qr-status" style="font-size:17px;font-weight:800;color:#d97706;margin-bottom:14px;line-height:1.5">
        📱 手机端直接<strong>长按上方二维码 → 点「识别图中二维码」</strong>即可一键登录并记住本机
      </div>
      <button class="btn-outline" style="font-size:16px;padding:10px 18px;border-radius:10px;font-weight:700" onclick="startGateWeChatQr()">
        🔄 刷新二维码
      </button>
    </div>
  </div>
</body>
</html>`;

export async function webAppRoutes(app: FastifyInstance): Promise<void> {
  app.get('/robots.txt', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .code(200)
      .header('content-type', 'text/plain; charset=utf-8')
      .send('User-agent: *\nDisallow: /\n');
  });

  app.get(
    '/app',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .header('x-robots-tag', 'noindex, nofollow, noarchive')
        .send(WEB_APP_HTML);
    },
  );

  app.get(
    '/webhooks/wechat-mp/menu-config',
    async (
      req: FastifyRequest<{ Querystring: { base_url?: string } }>,
      reply: FastifyReply,
    ) => {
      const baseUrl = req.query.base_url || 'https://mea.xgar.com.cn';
      return reply.code(200).send(buildServiceAccountMenuConfig(baseUrl));
    },
  );
}
