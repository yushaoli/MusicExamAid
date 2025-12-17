Below is the **Teacher Roster (T1) Spec**, aligned to the same status machine, missing-flag logic, “彩照 gate at Lock,” and export v2.1.

---

# Canonical Screen Spec — T1 Teacher Roster (MVP v2.1)

## 1) Scope and purpose

* **Screen:** `T1 Roster (MusicClass + cycle + status)`
* **Primary job:** Help teacher efficiently:

  1. find **Submitted/NeedsChanges/Confirmed** records that need action,
  2. drive them to **Locked**, and
  3. export **Locked-only** Excel batches.

---

## 2) Data grain and list model

**Option A (recommended MVP):** list rows = **RegistrationRecord**

* Pros: direct workflow control; matches export row semantics
* Cons: a student with multiple subjects appears multiple times (acceptable for MVP)

**Option B (later):** list rows = **Learner**, with nested registrations

* Better UX long term; more complex now

MVP decision: **Option A**.

---

## 3) Screen layout

### Header (sticky)

* Title: `老师端 · 报名管理`
* Current org selector: `机构 (MusicClass)` (required)
* Current cycle selector: `考期 (cycle_id)` (required)
* CTA group:

  * `导出Excel (Locked only)` → T4
  * `导出说明` (optional help tooltip)

### Filter bar

* 状态 filter (multi-select):

  * `Submitted`, `NeedsChanges`, `Confirmed`, `Locked`
  * Default: `Submitted + Confirmed` (actionable first)
* 专业 filter:

  * dropdown from ExamSubject
* 级别 filter:

  * dropdown 1–11 (or filtered by subject if selected)
* “只看有问题” toggle:

  * on = show rows with any missing flags or hard blocks
* Search box:

  * keyword match on learner name / phone last4 / certificate no (optional)

### Metrics row (chips)

* `Submitted: X`
* `NeedsChanges: Y`
* `Confirmed: Z`
* `Locked: K`
* `Lock-blocked (缺彩照): N` (derived)

---

## 4) Roster table/list row (per RegistrationRecord)

### Row fields

* 学员姓名: `LearnerProfile.name_cn` (secondary: 拼音/英文)
* 专业/级别: `instrument + level`
* 状态 badge: `status`
* 最后更新: `updated_at` or `reviewed_at`
* 缺失/问题 badges (priority order):

  1. **Hard blocks**: `级别越界` / `考试方式不匹配`
  2. **Submit blocks**: `缺证件号` / `缺出生日期` / `缺联系电话`…
  3. **Lock gates**: `缺彩照（锁定前必补）`

### Row actions (right side)

* Primary CTA: `查看` → opens T2 Student Detail (focused on this reg_id)
* Quick actions (optional MVP, but valuable):

  * `退回补彩照` (only when missing_portrait_photo)
  * `确认` (when status=Submitted and no submit blocks)
  * `锁定` (when status=Confirmed and lock gates clear)

**Recommendation:** implement `查看` first; add quick actions once stable.

---

## 5) Action rules (canonical)

### 5.1 “查看” → T2 focus

* Navigates to T2 Student Detail
* Auto-selects:

  * same `cycle_id`
  * highlights the clicked `reg_id` in the Registration tab

### 5.2 Quick “退回补彩照”

**Visible when:**

* `missing_portrait_photo == true`
* status in {Submitted, Confirmed}
  **Action:**
* status → NeedsChanges
* teacher_notes auto-append: “缺彩照（锁定前必补）”
* AuditLog: REQUEST_CHANGES

### 5.3 Quick “确认”

**Visible when:**

* status==Submitted
* no hard blocks
* no submit-block missing flags
  **Action:**
* status → Confirmed
* AuditLog: CONFIRM

### 5.4 Quick “锁定”

**Visible when:**

* status==Confirmed
* no hard blocks
* no submit blocks
* no lock gates (portrait present)
  **Action:**
* status → Locked
* write snapshot_json
* AuditLog: LOCK

---

## 6) Missing-flag computation (reused from canonical logic)

T1 should compute and show the same flags as T2b:

### Hard blocks (block Confirm/Lock)

* `level_exceeds_max_level`
* `exam_mode_invalid_for_subject`

### Submit-block missing

Identity: name_cn, gender, dob, nationality, id_type, id_number, guardian_phone
Registration: cycle_id, class_id, subject_id, level, exam_mode

### Lock gates

* `missing_portrait_photo`

---

## 7) Bulk operations (optional but useful in MVP)

If you include a checkbox multi-select:

* Bulk `退回修改` (requires selecting a preset reason)
* Bulk `确认` (only for eligible)
* Bulk `锁定` (only for eligible; requires all pass lock gates)

For MVP simplicity, you can defer bulk actions and keep:

* Bulk **Export** only (Locked-only).

---

## 8) Export entry points

Two entry points should exist:

1. Header CTA `导出Excel` → T4
2. “Locked chip” clickable → pre-filter to Locked, then CTA to export

Export constraints:

* export requires selected `MusicClass` + `cycle_id`
* export set = all `Locked` records under that filter

---

## 9) Empty/error states

* No records:

  * “本考期暂无报名记录”
* No actionable records (e.g., only Locked):

  * show prompt: “可直接导出Excel”
* Mixed issues:

  * show “只看有问题” helper hint

---

## 10) Minimal analytics events (optional, but helps ops)

* teacher_roster_viewed (org, cycle)
* teacher_record_opened (reg_id)
* teacher_quick_action_used (action type)
* teacher_export_started / succeeded / failed (count)

---

If you want, the next logical artifact is the **T4 Export screen spec** (inputs, file naming, export log, and error handling), but we can also pause here and move back to Task #2/#3 consolidation now that the screens are fully defined.
