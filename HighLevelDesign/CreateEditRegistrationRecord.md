Below is the **Canonical Form Spec** for **R2/R3 (Create/Edit RegistrationRecord)**, designed to be implementation-ready and aligned to your MVP template v2.1, your data model, and the “彩照 gate at Lock” decision.

---

# Canonical Form Spec — R2/R3 RegistrationRecord (MVP v2.1)

## 1) Scope

* Applies to:

  * **R2 Create RegistrationRecord**
  * **R3 Registration Detail** (edit mode for Draft/NeedsChanges)
* Output:

  * A valid `RegistrationRecord` that can be submitted to teacher
  * A teacher-lockable record once required gates are satisfied (including 彩照)

---

## 2) Page layout (fixed order)

### Section A — Header

* Title: `报名信息`
* Sub-title (dynamic): `"{{cycle_id}} · {{instrument}} {{level}}级"` (if created)
* Status badge: `Draft / Submitted / NeedsChanges / Confirmed / Locked`
* Context chip: `当前学员：{{LearnerProfile.name_cn}}`

**R3-only:**

* If `NeedsChanges`: show a red banner:

  * `"老师已退回：{{teacher_notes}}"`

---

### Section B — 报考信息 (Registration core)

**Field B1 — 考期 `cycle_id`**

* Type: dropdown
* Required: **Yes**
* Source: configured list (admin/seeding)
* Default: current cycle
* Validation: must be selected

**Field B2 — 机构（报名机构）`class_id`**

* Display: `MusicClass.name`
* Stored: `RegistrationRecord.class_id` + (derived) `MusicClass.legacy_org_id`
* Required: **Yes**
* Source: MusicClass list (teacher orgs)
* Search: yes (typeahead)
* Validation:

  * selected org must exist
  * store `legacy_org_id` for export snapshot at lock

**Field B3 — 报名点ID `exam_site_id_optional`**

* Type: numeric dropdown or hidden
* Required: No
* MVP default: empty (official default)
* If you have MusicClass.default_site_id_optional: auto-fill but editable

**Field B4 — 报考专业 `subject_id` / `instrument`**

* Type: dropdown
* Required: **Yes**
* Source: `ExamSubject` dictionary (`subject_name`, `max_level`)
* On change:

  * reset B5 level if out of new max_level
  * set default exam_mode (B6) depending on subject
* Validation: selected subject exists and active

**Field B5 — 报考级别 `level`**

* Type: dropdown (integers)
* Required: **Yes**
* Source: 1..`ExamSubject.max_level` for chosen subject
* Display: show “11=演奏级” if available for this subject
* Validation:

  * `1 ≤ level ≤ max_level(subject)`
  * If user tries to bypass, block save/submit

**Field B6 — 考试方式 `exam_mode`**

* Type: dropdown
* Required: **Yes**
* Allowed values: `现场 / 视频 / 音基`
* Rules:

  * If subject == `音乐基础知识`: force `音基` and disable field
  * Else: allow `现场/视频` (and optionally disallow 音基)
* Validation: required and must match allowed set

**Field B7 — 报考状态 `status`**

* Type: dropdown
* Required: Recommended **Yes** in system (template allows blank)
* Default: `审核通过` (or your operational default)
* Allowed values: `未申请 / 审核中 / 审核通过`
* Validation: must be one of allowed values

---

### Section C — 考试曲目 (Repertoire, up to 4)

**Fields C1–C4 — 考试曲目1..4**

* Type: text inputs
* Required: No (template optional)
* Constraints:

  * max length (recommend 60–80 chars each)
  * trimming whitespace
* Storage: `repertoire_json = ["...", "...", "...", "..."]`

**UI hint:**

* If empty: show “如简章要求填报曲目，请填写；否则可留空”

---

### Section D — 学员信息预览 (Read-only pull from LearnerProfile)

This section is **not editable here** (link to profile edit), but required for submission clarity.

Display (read-only):

* 姓名（中文）
* 拼音或英文（如有）
* 性别
* 国籍 / 民族
* 证件类型
* 证件号码（默认脱敏：仅后4位）
* 联系电话
* 出生日期
* 邮寄地址 / 收件人 / 收件电话（如有）

**Link CTA:** `去完善学员档案` → P1 (returns back after save)

---

### Section E — 照片与材料 (Attachments)

**Attachment E1 — 彩照 `portrait_photo`**

* Owner: `LearnerProfile`
* Required for submit: **No**
* Required for teacher lock: **Yes** (gate)
* UI states:

  * 未上传: show placeholder + CTA `上传彩照`
  * 已上传: thumbnail + `更换`
* Hint text:

  * “可先提交给老师；锁定导出前必须补齐彩照”

**Attachment E2 — 证照正面 `id_front`**

* Owner: `LearnerProfile`
* Required: No (unless future template/ops requires)
* UI: same pattern; show “可选”

---

## 3) Consent micro-gates (sensitive PI)

Trigger only when user first attempts either:

* entering ID number (in P1) OR
* uploading 彩照/证件照 OR
* uploading certificate images

**Modal content (MVP):**

* Purpose: “用于考级报名信息整理与导出模板”
* Data types: “证件号码、照片、证书图片等”
* Storage/retention: short statement + link
* CTA: `同意` / `不同意`

Store:

* consent_version
* timestamp
* scope flags (id/photo/certificate)

---

## 4) Save / Submit behavior

### Save as Draft

* Allowed statuses: Draft, NeedsChanges
* Server action: upsert RegistrationRecord (no status change)
* Client feedback: toast “已保存草稿”

### Submit to Teacher

* Allowed statuses: Draft, NeedsChanges
* Status set to: `Submitted`
* Pre-submit validation set:

  * Required fields in Section B pass
  * LearnerProfile required identity fields exist (name, gender, dob, id_type, id_number, phone, nationality)
  * 彩照 **not required** here
* If missing learner identity:

  * block submit
  * show missing checklist + link to P1

---

## 5) “Missing item badge” logic (canonical)

Compute missing flags per RegistrationRecord for list views (Parent R1 and Teacher T1) and for the submit checklist.

### Identity missing flags (block submit)

* missing_name_cn
* missing_gender
* missing_dob
* missing_nationality
* missing_id_type
* missing_id_number
* missing_guardian_phone

### Registration missing flags (block submit)

* missing_cycle_id
* missing_class_id
* missing_subject_id
* missing_level
* missing_exam_mode

### Lock gate flags (do NOT block submit; block lock)

* missing_portrait_photo  **(blocks teacher Lock)**

### Rule flags (block save/submit)

* level_exceeds_max_level (hard block)
* exam_mode_invalid_for_subject (hard block)

Display priority (badges):

1. Hard blocks (level invalid)
2. Submit blocks (missing required)
3. Lock gates (缺彩照—锁定前必补)

---

## 6) Teacher Lock requirements (for T2b)

To enable `锁定`:

* status must be `Confirmed` (or allow lock directly from Submitted; your call, but keep consistent)
* no hard blocks
* no submit-block missing fields
* **彩照存在** (`portrait_photo` attachment exists)

When teacher locks:

* write `snapshot_json` including all template columns + org_id + teacher contact snapshots
* set status=Locked

---

## 7) R3 Read-only behavior by status

* Draft / NeedsChanges: editable sections B–C; attachments E editable; profile preview read-only
* Submitted: read-only (or allow edit only if you support “withdraw”; MVP can be read-only)
* Confirmed: read-only
* Locked: read-only + “仅老师可解锁”

---

If you want, the next step is to generate the matching **Teacher-side review panel spec (T2b)** with the same missing-flag logic and button enable/disable rules, so both sides are perfectly consistent.
