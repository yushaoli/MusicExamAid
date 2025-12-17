Confirmed: we will treat **“导入报名资料-模板 v2.1”** as the **single MVP export template**, and derive required fields from it.

Below is the **tightened screen-by-screen field list** (Parent + Teacher), with **required/optional** flags and the key validation/consent gates.

---

# Screen-by-screen Field List (MVP, Template v2.1)

## G0 Privacy & Terms Gate

* **Required actions**

  * Accept 用户协议/隐私政策（store consent version + timestamp）
* **CTA**

  * `同意并继续` / `不同意退出`

---

## P1 LearnerProfile Create/Edit（学生档案）

**Goal:** maintain learner identity. To satisfy minimization, sensitive items can be deferred until Registration, but we should still support filling here for convenience.

### Fields

**Basic identity**

* 姓名（中文）`name_cn` — **Required**
* 拼音或英文 `name_en_optional` — Optional
* 性别 `gender` — **Required** (男/女)
* 出生日期 `dob` — **Required** (date)

**Nationality**

* 国籍 `nationality` — **Required** (default 中国)
* 民族 `ethnicity` — Optional

**ID + contact**

* 证件类型 `id_type` — **Required**
* 证件号码 `id_number` — **Required** (sensitive; masked in UI)
* 联系电话 `guardian_phone` — **Required**

**Mailing (template columns exist; optional)**

* 邮寄地址 `mailing_address_optional` — Optional
* 收件人 `recipient_name_optional` — Optional
* 收件电话 `recipient_phone_optional` — Optional

### Attachments (Attachment.owner_type="LearnerProfile")

* 彩照 `portrait_photo` — Optional here; **Required before teacher Lock if template requires it operationally**
* 证照正面 `id_front` — Optional (unless your ops decides it’s mandatory)

### CTAs

* `保存`
* `保存并返回`

### Validation

* phone format, dob format
* ID stored encrypted; UI default shows last 4

---

## R1 Registration List（报名信息列表）

**Shows per RegistrationRecord**

* 专业 `instrument`
* 级别 `level`
* 机构（MusicClass.name / legacy_org_id）
* 状态 `status` (Draft/Submitted/NeedsChanges/Confirmed/Locked)
* 缺失项 badges (computed from template-required fields + attachment presence)

**CTAs**

* `新建报考` → R2
* `打开` → R3

---

## R2 Create RegistrationRecord（新建报考）

**Goal:** create one exportable row (per 专业/级别) for a cycle.

### Consent micro-gate S1 (first time only)

Before allowing entry of ID number / uploading portrait photo:

* 单独同意：证件号码、彩照、证件照、证书附件等敏感信息处理

### Fields (RegistrationRecord)

**Cycle & organization**

* 考期 `cycle_id` — **Required**
* 报名机构ID `legacy_org_id` (via MusicClass) — **Required**
* 报名点ID `exam_site_id_optional` — Optional (if you use it)

**Subject & level (from ExamSubject dictionary)**

* 报考专业 `instrument` / `subject_id` — **Required**
* 报考级别 `level` — **Required**

  * Rule: `1 ≤ level ≤ max_level(subject)`

**Exam metadata (template columns)**

* 考试方式 `exam_mode` — **Required**

  * Rule: 专业=音乐基础知识 ⇒ 强制 “音基”
* 报考状态 `status` — Optional in template, but **recommended Required in system** with default `审核通过` (or your chosen default)

**Repertoire (template columns)**

* 考试曲目1–4 — Optional (store as `repertoire_json`)

### Profile preview (read-only pull from LearnerProfile)

Show for confirmation:

* 姓名、拼音/英文、性别、国籍、民族、证件类型、证件号码（脱敏）、联系电话、出生日期、邮寄信息

### Attachments required gate S2 (before submit)

* 彩照 `portrait_photo` — **Strongly recommended required before Submit/Lock** (even if template doesn’t embed it, most official workflows require photo upload elsewhere; keeping it here prevents rework)

### CTAs

* `保存草稿`
* `保存并提交老师` → R4

---

## R3 Registration Detail（报名详情）

Same fields as R2; editability depends on status:

* Draft / NeedsChanges: editable
* Submitted / Confirmed: read-only (or allow limited edits if you choose)
* Locked: strictly read-only (teacher unlock only)

**Teacher feedback panel** (when NeedsChanges)

* 显示 `teacher_notes` + missing items checklist

**CTAs**

* Draft/NeedsChanges: `保存` / `提交老师`

---

## R4 Submit Confirmation（提交确认）

* Checklist of template-required fields (plus attachment requirements you enforce)
* CTA: `确认提交` → status=Submitted

---

## A1 Archive List（考级档案列表）

* List fields: board, cycle/date, 专业, 级别, 成绩, 证书编号(如有), 附件数
* CTAs: `去国音查询` (WebView launcher), `新增档案记录`

---

## A3 Save Archive Record（保存到档案）

(Store as `ExamRecord`; later can link to Certification.)
**Fields**

* 考级机构（默认 国音）— Required
* 考期/日期 — Required
* 专业、级别 — Required
* 成绩 — Required
* 证书编号 — Optional
* 附件（截图/电子证书）— Optional (but recommended)

---

## C1 Certification List（证书列表）

* 专业、级别、获得年月、证书编号、确认状态
* CTA: `新增证书` / `编辑`

## C2 Certification Create/Edit

**Fields (Certification)**

* 专业名称 — **Required**
* 几级证书 — **Required**
* 获得年月（YYYY-MM）— **Required**
* 考级委员会名称 — Optional
* 证书编号 — **Required**
* 证书照片（Attachment.owner_type="Certification"）— Optional (recommended)

---

# Teacher Console screens

## T1 Roster（学生报名列表）

**Filters**

* 机构（MusicClass / legacy_org_id）
* 考期 cycle_id
* 状态（Submitted/NeedsChanges/Confirmed/Locked）
* 专业、级别

**Row shows**

* 学生姓名
* 专业/级别
* 状态
* 缺失项 badges

**CTAs**

* `查看` → T2
* `导出` → T4

---

## T2 Student Detail tabs

### T2a Profile Tab（学生档案）

* View all LearnerProfile fields + attachments
* Limited edits (formatting corrections)
* ID reveal action logged

**CTAs**

* `保存修改`
* `退回补充材料` (writes NeedsChanges + notes on related registrations)

### T2b Registration Tab（报名记录）

Per RegistrationRecord:

* Review all fields + learner preview
* Enter `teacher_notes`

**CTAs (per record)**

* `退回修改` → status=NeedsChanges
* `确认` → status=Confirmed
* `锁定` → status=Locked + write `snapshot_json` (export source of truth)
* `解锁` (restricted) → Locked→Confirmed

### T2c Archive/Certification Tab

* View ExamRecords + Certifications
* Teacher confirm Certification (`confirm_status=TeacherConfirmed`)

---

## T4 Export（导出Excel v2.1）

Inputs:

* 机构（legacy_org_id）
* 考期
* 模板：v2.1 (fixed)

Rules:

* Export **Locked only**
* Export values from `snapshot_json`:

  * 报名机构ID、报名点ID
  * 姓名、拼音/英文、性别、国籍、民族
  * 证件类型、证件号码（文本）、联系电话
  * 报考专业、报考级别、考试曲目1–4
  * 出生日期（统一格式）
  * 邮寄地址、收件人、收件电话
  * 集体老师姓名、集体老师联系电话
  * 考试方式、报考状态

---

## Immediate decision I recommend locking now (so dev doesn’t churn)

* Do we enforce **彩照必须在“提交老师”前上传**，还是允许提交但在老师“锁定”时强制补齐？

  * My recommendation for MVP: **允许提交，但锁定前必须补齐**（减少家长中途放弃，同时保证导出批次质量）。

If you accept that, the next document I will produce is a **single canonical form spec** for R2/R3 (field order, dropdown sources, validation messages, and computed “缺失项” rules), which will let UI + backend implement in parallel with minimal ambiguity.
