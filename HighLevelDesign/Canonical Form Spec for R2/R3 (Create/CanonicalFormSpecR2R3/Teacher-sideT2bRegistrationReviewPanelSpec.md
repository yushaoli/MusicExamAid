Below is the **Teacher-side T2b Registration Review Panel Spec** (canonical), fully consistent with the R2/R3 form spec, the “彩照 gate at Lock” rule, and template v2.1 export.

---

# Canonical Panel Spec — T2b Registration Review (Teacher Console, MVP v2.1)

## 1) Scope

* Applies to **T2 Student Detail → Registration Tab (T2b)**
* Teacher operates within a selected **MusicClass (机构)** and **cycle_id (考期)**
* Goal: move records through **Submitted → (NeedsChanges|Confirmed) → Locked**, then export **Locked-only**.

---

## 2) Layout (fixed)

### Panel Header (sticky)

* Student: `{{LearnerProfile.name_cn}}` (secondary: 拼音/英文)
* Current cycle selector: `cycle_id` (dropdown, defaults to filter selection)
* Summary chips:

  * `Submitted: X` `NeedsChanges: Y` `Confirmed: Z` `Locked: K`
* CTA (optional): `导出本考期(锁定K条)` → T4

### Records List (left) + Detail Drawer (right)

* Left list row shows:

  * 专业 `instrument`
  * 级别 `level`
  * 状态 `status`
  * Missing badges (canonical rules below)
* Clicking a row opens the Detail Drawer for that record.

---

## 3) Detail Drawer — Sections & fields (read-only + controlled edits)

### Section A — Registration Snapshot Preview (read-only)

Shows *current* data (pre-lock) in a template-like layout:

* 考期 `cycle_id`
* 机构 `MusicClass.name` + `legacy_org_id`
* 报考专业、报考级别、考试方式、报考状态
* 考试曲目1–4
* 报名点ID（if used)

### Section B — LearnerProfile Preview (read-only; sensitive-by-default)

Displays:

* 姓名（中文）、拼音/英文、性别、出生日期
* 国籍/民族
* 证件类型
* 证件号码：默认 **仅后4位**（masked）

  * Button: `显示完整证件号` (requires confirm; logs AuditLog)
* 联系电话
* 邮寄地址/收件人/收件电话（如有）

Attachments status:

* 彩照（portrait_photo）：已上传/未上传 + thumbnail if present
* 证照正面（id_front）：已上传/未上传

### Section C — Teacher Notes (editable)

* Field: `teacher_notes` (multiline)
* Quick-select reason presets (chips) to append to notes:

  * `缺彩照（锁定前必补）`
  * `证件号码有误/不清晰`
  * `出生日期格式/信息不一致`
  * `专业/级别选择不符合简章`
  * `曲目填写不完整/不规范`
  * `联系电话需确认`
  * `其他（自定义）`

### Section D — Action Bar (per-record)

Buttons (left-to-right):

1. `退回修改` (NeedsChanges)
2. `确认` (Confirmed)
3. `锁定` (Locked) — **gate-controlled**
4. `解锁` (restricted; only when Locked)

---

## 4) Status transitions (canonical)

### 4.1 退回修改 → NeedsChanges

**Allowed current status:** `Submitted`, `Confirmed`
**Required inputs:** `teacher_notes` must be non-empty (enforce)
**System actions:**

* status = NeedsChanges
* reviewed_at = now
* AuditLog: action=REQUEST_CHANGES + diff

**UI behavior:**

* After action, record remains visible and marked NeedsChanges.
* Parent sees the notes and can edit + resubmit.

---

### 4.2 确认 → Confirmed

**Allowed current status:** `Submitted`
**Hard blocks (must pass)**

* No “Submit-block” missing fields (see §6)
* No rule violations (level/max_level, exam_mode rules)

**System actions:**

* status = Confirmed
* reviewed_at = now
* AuditLog: action=CONFIRM

---

### 4.3 锁定 → Locked (export-eligible)

**Allowed current status:** `Confirmed`
(**Optional policy:** allow lock from Submitted; if you do, run the same checks as Confirm + Lock together. MVP recommendation: require Confirm first.)

**Lock gates**

* All Confirm checks pass
* **彩照存在** (`portrait_photo` exists) — *the key gate you approved*
* Any additional ops-required attachments (none in MVP except portrait_photo)

**System actions (atomic transaction)**

1. Generate `snapshot_json` (see §7)
2. status = Locked
3. locked_at = now
4. AuditLog: action=LOCK + snapshot hash

**UI behavior**

* If gate fails, disable Lock and show missing reason(s) inline.

---

### 4.4 解锁 → Confirmed (restricted)

**Allowed current status:** `Locked`
**Permissions:** teacher role allowed, but optionally limited to “org admin”
**System actions:**

* status = Confirmed
* AuditLog: action=UNLOCK + reason (required)

---

## 5) Lock button enable/disable rules (exact)

### Lock enabled when ALL true:

* `status == Confirmed`
* `missing_flags.submit_blocks == []`
* `missing_flags.hard_blocks == []`
* `missing_flags.lock_gates == []` where lock_gates includes `missing_portrait_photo`

### Lock disabled copy examples:

* If missing portrait: `“锁定前需补齐：彩照”`
* If missing ID: `“锁定前需补齐：证件号码”` (submit-block; should not be Confirmed anyway)
* If level invalid: `“级别超出该专业允许范围”`

---

## 6) Missing-item flags (shared canonical logic)

Same as parent side, but teacher sees them more explicitly.

### 6.1 Hard blocks (block Confirm + Lock)

* `level_exceeds_max_level`
* `exam_mode_invalid_for_subject`

### 6.2 Submit-block missing (block Confirm + Lock)

Identity missing (from LearnerProfile):

* missing_name_cn
* missing_gender
* missing_dob
* missing_nationality
* missing_id_type
* missing_id_number
* missing_guardian_phone

Registration missing:

* missing_cycle_id
* missing_class_id
* missing_subject_id
* missing_level
* missing_exam_mode

### 6.3 Lock-gate missing (does NOT block Submit, blocks Lock)

* `missing_portrait_photo`

**Badge priority (for roster + record list)**

1. hard blocks
2. submit-block missing
3. lock-gate (缺彩照)

---

## 7) snapshot_json schema (Template v2.1 authoritative)

Generated at Lock time; export reads from snapshot only.

```json
{
  "template_version": "v2.1",
  "cycle_id": "2026寒假",

  "legacy_org_id": 2,
  "exam_site_id_optional": 1,

  "name_cn": "王槿妤",
  "name_en_optional": "Wang Jin Yu",
  "gender": "女",
  "nationality": "中国",
  "ethnicity": "汉族",

  "id_type": "身份证",
  "id_number_plaintext": "****************1234",
  "id_number_full_plaintext": "xxxxxxxxxxxxxxxxxx", 
  "guardian_phone": "138********",

  "dob": "2015-07-22",

  "mailing_address_optional": "",
  "recipient_name_optional": "",
  "recipient_phone_optional": "",

  "instrument": "钢琴",
  "subject_id": 15,
  "level": 8,

  "repertoire": ["曲目1", "曲目2", "", ""],

  "teacher_name": "张三",
  "teacher_phone": "139********",

  "exam_mode": "视频",
  "status": "审核通过",

  "risk_flags": []
}
```

**Implementation notes**

* Store **full ID plaintext only if absolutely needed** for export; otherwise store encrypted separately and inject during export server-side.
* In `snapshot_json`, prefer storing *masked* versions for UI, and keep the export pipeline responsible for injecting unmasked values under authorization.

---

## 8) “退回原因” presets (standardize)

Provide quick reasons with structured codes (for analytics later):

* CODE_PHOTO_MISSING
* CODE_ID_INCONSISTENT
* CODE_DOB_INCONSISTENT
* CODE_SUBJECT_LEVEL_INVALID
* CODE_REPERTOIRE_INVALID
* CODE_PHONE_INVALID
* CODE_OTHER

Store:

* `teacher_notes`
* `teacher_reason_codes[]` (optional MVP; can be embedded in notes if you want to keep DB minimal)

---

## 9) Export readiness indicator (per record, per cycle)

In T2b list, show:

* `Exportable` badge when `status==Locked`
* `Blocked` badge with first blocking reason otherwise

---

If you want, I can now update the **Teacher Roster (T1) spec** to ensure its filters, badges, and bulk actions align with the same missing-flag logic and status transitions.
