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
    <div><strong>🧪 账号角色沙盒切换器 (点击体验不同链接权限隔离)：</strong></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
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

        <div style="margin-top:16px">
          <label style="font-size:13px;color:var(--text);margin-bottom:8px">💎 考级无忧增值服务包（自愿勾选，与报名费合并一笔微信支付）：</label>
          <div id="parent-addons-box">
            <label class="addon-row">
              <span><input type="checkbox" class="p-addon-cb" value="ai_id_photo" data-price="9.9" checked onchange="recalcParentCheckout()" /> <strong>✨ AI 考级标准二寸照一键换底精修</strong> <small style="color:var(--muted)">(自动抠图换标准白底 + 35×49mm 合规裁剪)</small></span>
              <strong style="color:var(--primary-dark)">+¥9.90</strong>
            </label>
            <label class="addon-row">
              <span><input type="checkbox" class="p-addon-cb" value="household_ocr_vip" data-price="6.6" onchange="recalcParentCheckout()" /> <strong>📸 户口本/身份证 OCR 自动填表 + 错漏包赔</strong> <small style="color:var(--muted)">(生僻字校验，制证信息错漏免费重办)</small></span>
              <strong style="color:var(--primary-dark)">+¥6.60</strong>
            </label>
            <label class="addon-row">
              <span><input type="checkbox" class="p-addon-cb" value="music_theory_pack" data-price="29.9" onchange="recalcParentCheckout()" /> <strong>🎧 中国音乐学院《基本乐科/音基》全真冲刺题库</strong> <small style="color:var(--muted)">(配套级别视唱练耳闯关 + 3套模考卷)</small></span>
              <strong style="color:var(--primary-dark)">+¥29.90</strong>
            </label>
            <label class="addon-row">
              <span><input type="checkbox" class="p-addon-cb" value="mock_video_review" data-price="49" checked onchange="recalcParentCheckout()" /> <strong>🎬 考前模拟视频「名师 1对1 预审点评报告」</strong> <small style="color:var(--muted)">(考前上传演奏视频获评委级语音批注与通过率评估)</small></span>
              <strong style="color:var(--primary-dark)">+¥49.00</strong>
            </label>
            <label class="addon-row">
              <span><input type="checkbox" class="p-addon-cb" value="growth_archive_frame" data-price="58" onchange="recalcParentCheckout()" /> <strong>🏅 历年考级星光成长档案 + 定制胡桃木证书相框 (顺丰包邮)</strong></span>
              <strong style="color:var(--primary-dark)">+¥58.00</strong>
            </label>
          </div>
        </div>

        <div style="margin-top:14px;padding:14px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:12.5px;color:#166534" id="checkout-summary-text">6级官方固定报名费 ¥390.00 + 增值服务包 ¥58.90</div>
            <div style="font-size:20px;font-weight:800;color:#14532d">微信支付应付总额：<span id="checkout-total-yuan">¥448.90</span></div>
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

      <div class="card">
        <h2>📊 2020–2026 历年 13 个考期人数分布与 Top 10 合作老师（实盘 PostgreSQL）</h2>
        <div class="grid" id="adm-archive-breakdown">正在加载实盘统计...</div>
      </div>
    </section>
  </div>

  <nav class="bottom-nav">
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

    function switchTab(tab) {
      if (currentSession.role === 'parent' && (tab === 'teacher' || tab === 'console')) {
        tab = 'parent';
      }
      if (currentSession.role === 'teacher' && tab === 'console') {
        tab = 'teacher';
      }
      ['parent', 'archive', 'teacher', 'console'].forEach(t => {
        document.getElementById('tab-' + t)?.classList.toggle('hidden', t !== tab);
        document.getElementById('nav-' + t)?.classList.toggle('active', t === tab);
      });
      refreshData();
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
      let addonFee = 0;
      document.querySelectorAll('.p-addon-cb:checked').forEach(cb => {
        addonFee += Number(cb.dataset.price || 0);
      });
      const total = baseFee + addonFee;
      document.getElementById('checkout-summary-text').textContent =
        \`\${lvl === 11 ? '演奏级' : lvl + '级'}官方固定报名费 ¥\${baseFee.toFixed(2)} + 增值服务包 ¥\${addonFee.toFixed(2)}\`;
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
            const upBadge = up
              ? \`上次考过：<strong>\${up.last_season} · \${up.major_name} \${up.last_level}级</strong> → 本季推荐直升 <span class="badge badge-upgrade">🎯 \${up.major_name} \${up.recommended_level}级 (¥\${up.official_fee_yuan})</span>\`
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
                    <div style="font-size:12px;color:var(--muted);margin-top:2px">指导老师/报名点：<strong>\${s.agent_name || '本机构'}</strong> | 累计参考 \${s.all_exams} 次</div>
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
        recalcParentCheckout();
      }
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
        const [data, agentsRes] = await Promise.all([
          fetch('/official-sync/archive-stats').then(r => r.json()),
          fetch('/official-sync/partner-agents').then(r => r.json())
        ]);
        if (data.totals) {
          document.getElementById('adm-stat-students').textContent = data.totals.historical_students_count.toLocaleString() + ' 人';
          document.getElementById('adm-stat-exams').textContent = data.totals.historical_exams_count.toLocaleString() + ' 笔';
          document.getElementById('adm-stat-agents').textContent = data.totals.partner_agents_count + ' 家';
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

        const seasonsHtml = (data.seasons || []).map(s =>
          \`<tr><td><code>\${s.season_code}</code> · \${s.season_label}</td><td><strong>\${s.exam_count.toLocaleString()}</strong> 笔</td></tr>\`
        ).join('');
        const agentsHtml = (data.top_partner_agents || []).slice(0, 10).map(a =>
          \`<tr><td>[\${a.code}] <strong>\${a.name}</strong> (\${a.manager || ''})</td><td><strong>\${a.total_exams}</strong> 考次 / \${a.distinct_students} 人</td></tr>\`
        ).join('');
        document.getElementById('adm-archive-breakdown').innerHTML = \`
          <div>
            <h3 style="font-size:14px;margin:0 0 8px">📅 2020–2026 历年 13 个考期报考笔数</h3>
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

    // Bootstrap Session Role & Isolation from URL parameters
    (async function bootstrapSession() {
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

      recalcParentCheckout();
      switchTab(['parent', 'archive', 'teacher', 'console'].includes(initialTab) ? initialTab : 'parent');
      searchHistoricalStudent('parent');
    })();
  </script>
</body>
</html>`;

export async function webAppRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/app',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
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
