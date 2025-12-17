Below is **Task #1: Screen inventory + wireframe notes** (MVP v1.1), aligned to your current HLD, data model, and Mermaid conventions. I’m keeping it implementation-oriented: each screen lists **purpose, key fields, CTAs, states, and status transitions**.

---

# Task #1 — Screen Inventory + Wireframe Notes (MVP v1.1)

## A) Parent / Household (Mini Program)

### P0. WeChat Auth Gate (implicit)

* **Purpose:** obtain OpenID and create/lookup `HouseholdAccount`
* **CTA:** none (auto)
* **States:**

  * First-time: create account → go to P1
  * Returning: go to P2 (last used learner)

---

### P1. Onboarding: Create LearnerProfile

* **Purpose:** create first child profile quickly
* **Fields (LearnerProfile):**

  * 姓名（中文）`name_cn` (required)
  * 拼音/英文 `name_en_optional` (optional)
  * 性别 `gender` (required)
  * 出生日期 `dob` (required; accept YYYYMMDD input)
  * 国籍 `nationality` (default 中国; required)
  * 民族 `ethnicity` (optional)
  * 证件类型 `id_type` (required)
  * 证件号码 `id_number` (required; masked display)
  * 联系电话 `guardian_phone` (required)
* **Attachments (required gating later):**

  * 彩照 `portrait_photo` (optional at onboarding, required before submit if template requires)
  * 证照正面 `id_front` (optional unless template/teacher requires)
* **CTAs:**

  * 保存并继续 → P2
  * 暂不上传照片 → P2
* **Empty/Error states:**

  * Missing required fields → inline error
  * Invalid date/phone format → inline error

---

### P2. Home (Profile Selector + Quick Actions)

* **Purpose:** central hub; select learner and jump to practice/exam
* **Components:**

  * Learner selector (if >1 child; otherwise hidden)
  * Cards:

    * 练习（Practice）→ P10
    * 考级（Exam）→ P20
    * 进度（Progress）→ P30
* **CTAs:**

  * 切换学生
  * 新增学生 → P1
* **States:**

  * No learner → redirect P1

---

## Practice module

### P10. Practice Mode Selector

* **Purpose:** entry to 3 modes
* **Options:**

  * 音乐基础知识 → P11
  * 乐器陪练 → P12
  * 水平评估 → P13
* **CTAs:** start chosen mode

#### P11. 音乐基础知识（Quiz）

* **MVP note:** can be stubbed with “题包选择 + 做题 + 错题本” (does not affect registration/export)

#### P12. 乐器陪练（Record + Feedback）

* **MVP note:** does not affect export; keep separate storage (practice session table later)

#### P13. 水平评估（Assessment）

* **MVP note:** provides readiness label only; not required for registration MVP

---

## Exam module (核心)

### P20. Exam Hub（考级）

* **Purpose:** entry to registration + archive
* **Cards:**

  * 报名信息 → P21
  * 考级档案（国音）→ P25
  * 证书管理 → P28
* **CTAs:** enter each

---

### P21. Registration List (by cycle)

* **Purpose:** view and manage `RegistrationRecord` for current learner
* **Filters:**

  * 考期 `cycle_id` (default current)
  * 状态 `status` (Draft/Submitted/NeedsChanges/Confirmed/Locked)
* **List row shows:**

  * 专业 `instrument`
  * 级别 `level`
  * 机构 `MusicClass.name`
  * 状态 badge
  * 缺失提示（例如：缺彩照/缺证件号/级别不合法等）
* **CTAs:**

  * 新建报考 → P22
  * 打开某条记录 → P23
* **Empty states:**

  * 无报名记录：提示新建

---

### P22. Create RegistrationRecord（新建报考）

* **Purpose:** create one subject application for a cycle
* **Fields (RegistrationRecord):**

  * 考期 `cycle_id` (required)
  * 机构 `MusicClass` (required; choose from list / search)
  * 专业 `subject_id` / `instrument` (required; dropdown from ExamSubject)
  * 级别 `level` (required; **filtered to 1..max_level**)
  * 考试方式 `exam_mode` (required)

    * rule: if 专业=音乐基础知识 → exam_mode forced “音基”
  * 报考状态 `status` (default 未申请 / 审核中 / 审核通过 per ops preference)
  * 考试曲目（1–4）`repertoire` (optional; structured inputs)
* **CTAs:**

  * 保存为草稿 → P21
  * 保存并提交老师 → P24 (sets status=Submitted)
* **Validation:**

  * level within max_level (hard)
  * required fields present

---

### P23. RegistrationRecord Detail（报名详情）

* **Purpose:** edit/view one registration record
* **Header:** 专业 + 级别 + 状态
* **Sections:**

  1. 学生信息快照（read-only preview; pulls from LearnerProfile）

     * 姓名、性别、出生日期、证件类型（证件号默认脱敏）、联系电话
     * 彩照/证照正面：显示上传状态
  2. 报考信息（editable in Draft/NeedsChanges）

     * 机构、专业、级别、考试方式、曲目1–4
  3. 老师反馈（if NeedsChanges）

     * teacher_notes
* **CTAs:**

  * 编辑/保存（if Draft/NeedsChanges)
  * 提交老师（if Draft/NeedsChanges) → status=Submitted
  * 撤回提交（optional MVP; else omit)
* **Locked state:**

  * All fields read-only; show “已锁定，仅老师可解锁”

---

### P24. Submit Confirmation (提交给老师)

* **Purpose:** user confirmation before status change
* **Displays:**

  * checklist: required fields + required attachments status
* **CTAs:**

  * 确认提交 → set status=Submitted
  * 返回修改

---

### P25. Archive Hub（考级档案 - 国音）

* **Purpose:** assisted query + save exam record
* **Actions:**

  * 成绩查询（WebView）→ P26
  * 证书查询（WebView）→ P27
  * 档案列表 → P25a
* **CTAs:** open

#### P26. WebView: 国音成绩查询

* **Purpose:** open official page in WebView
* **CTA:** 返回并归档 → P25b (manual save form)

#### P27. WebView: 国音证书查询

* **Purpose:** open official page in WebView
* **CTA:** 返回并归档 → P25b

#### P25a. Archive List（档案列表）

* **List row:** board, 专业/级别, 日期/考期, 结果, 附件数
* **CTA:** 查看详情 → P25c; 新增归档 → P25b

#### P25b. Save Archive Record（保存到档案）

* **Purpose:** store structured `ExamRecord` (and optionally link to Certification later)
* **Fields:**

  * 考级机构（默认 国音）
  * 考期/日期（手输或选择）
  * 专业、级别
  * 成绩（合格/不合格/无成绩）
  * 证书编号（可选）
  * 上传附件：截图/电子证书
* **CTAs:** 保存

#### P25c. Archive Detail

* **Purpose:** view stored archive + attachments
* **CTAs:** 编辑（optional MVP), 删除（optional)

---

### P28. Certification List（证书管理）

* **Purpose:** manage `Certification` entity
* **List row:** 专业、级别、获得年月、证书编号、确认状态
* **CTAs:**

  * 新增证书 → P29
  * 查看/编辑 → P29 (edit mode)

### P29. Certification Create/Edit

* **Fields (Certification):**

  * 专业名称（dropdown）
  * 几级证书（1–11）
  * 获得年月（YYYY-MM）
  * 考级委员会名称（optional）
  * 证书编号（required）
  * 上传证书照片（Attachment: certificate_photo）
* **CTAs:**

  * 保存
  * 删除（edit only; optional)

---

## Progress module (MVP-light)

### P30. Progress Overview

* **Purpose:** show high-level activity; can be placeholder in MVP
* **CTAs:** none

---

## Me module (MVP-light)

### P40. Settings / Support

* **Purpose:** help, privacy notice, data deletion request entry
* **CTAs:** manage learners → P1/P2

---

# B) Teacher Console (limited UI)

### T0. Teacher Auth Gate

* **Purpose:** login and bind teacher identity to one or more `MusicClass`
* **MVP approach:** teacher selects a `MusicClass` (机构) from allowed list (admin-seeded)
* **CTA:** 进入老师端

---

### T1. Roster (by MusicClass + cycle)

* **Purpose:** manage registrations workflow
* **Filters:**

  * 机构（MusicClass）
  * 考期（cycle_id）
  * 状态（Submitted/NeedsChanges/Confirmed/Locked）
  * 专业、级别
* **List row shows:**

  * 学生姓名
  * 专业/级别
  * 状态 badge
  * 缺失项 badges（缺彩照/缺证件号/级别越界等）
* **CTAs:**

  * 打开学生详情 → T2
  * 批量导出（shortcut) → T4

---

### T2. Student Detail (tabs)

Tabs:

1. **Profile（学生档案）**
2. **Registration（报名记录）**
3. **Archive（档案/证书）**

#### T2a. Profile tab

* **Purpose:** view + limited corrections of LearnerProfile
* **Fields:** same as LearnerProfile + attachment status
* **Edit rules:**

  * allow formatting corrections (name/pinyin), phone fix
  * ID reveal action requires logging
* **CTAs:** 保存修改; 请求家长补充彩照/证件照（sets NeedsChanges reason template)

#### T2b. Registration tab

* **Purpose:** review/confirm/lock per RegistrationRecord
* **Components:**

  * list of registrations for this learner & cycle
  * each record has detail panel (专业/级别/曲目/考试方式)
  * teacher_notes input
* **CTAs per record:**

  * 退回修改 → status=NeedsChanges + notes
  * 确认 → status=Confirmed
  * 锁定 → status=Locked + write snapshot_json
  * 解锁（restricted）→ Locked→Confirmed

#### T2c. Archive tab

* **Purpose:** view saved 国音档案 + Certification list
* **CTAs:** Teacher confirm on Certification (sets `confirm_status=TeacherConfirmed`)

---

### T4. Export (Excel template v2.1)

* **Purpose:** export only Locked registrations for a given MusicClass + cycle
* **Inputs:**

  * 机构（MusicClass）
  * 考期（cycle）
  * 模板（v2.1）
* **Output:**

  * downloadable `.xlsx`
  * export summary (count, time, operator)
* **CTAs:**

  * 生成导出文件
  * 下载
* **Error states:**

  * 0 locked records
  * snapshot missing (should not happen if lock gate correct)

---

# C) Admin-lite (optional; if you need seed data)

### A1. Dictionary Import (ExamSubject/ExamLevel/MusicClass)

* **Purpose:** load your Excel lists into system
* **MVP note:** can be done as backend script; UI optional

---

## D) Screen-flow diagram (Parent core)

```mermaid
flowchart TB
  P2[Home] --> P20[Exam Hub]
  P20 --> P21[Registration List]
  P21 --> P22[Create Registration]
  P22 --> P24[Submit Confirm]
  P24 --> P21
  P21 --> P23[Registration Detail]
  P20 --> P25[Archive Hub]
  P25 --> P26[国音成绩 WebView]
  P25 --> P27[国音证书 WebView]
  P25 --> P25b[Save Archive Record]
  P20 --> P28[Certification List]
  P28 --> P29[Certification Create/Edit]
```

---

## E) Critical state transitions (where buttons change status)

* Parent “提交老师” (P22/P23 → P24) sets **Submitted**
* Teacher “退回修改” sets **NeedsChanges**
* Teacher “确认” sets **Confirmed**
* Teacher “锁定” sets **Locked + snapshot_json written**
* Teacher export pulls **Locked only**

---

If you want, next I will convert the above into a **single consolidated “Screen Spec” doc** with numbered components per screen (e.g., P22-1 Header, P22-2 Form, P22-3 Validation banner), which your dev can implement almost directly.
