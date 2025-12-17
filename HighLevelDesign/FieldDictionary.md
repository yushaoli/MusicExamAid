Understood. Below is a **single consolidated, authoritative Task #2 Field Dictionary (v2.0)** that aligns to:

* The finalized **screen flows** (Parent + Teacher)
* **Template v2.1 export** requirements
* Your **Mermaid/ERD naming conventions**
* The clarified distinction between **workflow status** vs **报考状态（application status）**
* The “**彩照 required at Lock**” rule

---

# Task #2 — Field Dictionary (Canonical v2.0)

## 0) Shared conventions

### 0.1 Primary keys

* All business entities use internal UUID string PKs (`*_id`) unless explicitly “legacy” ints.

### 0.2 Sensitive data handling (MVP baseline)

* `id_number` stored as **encrypted at rest** (`id_number_encrypted`).
* UI shows ID masked by default; “reveal full” is permissioned and **AuditLog**-recorded.
* Photos/certificates are stored as **Attachment** objects in object storage and referenced by `storage_url`.

### 0.3 Status separation (important)

For `RegistrationRecord`:

* `workflow_status` = Draft/Submitted/NeedsChanges/Confirmed/Locked (your state machine)
* `application_status` = 未申请/审核中/审核通过 (maps to Excel column 报考状态)

---

## 1) HouseholdAccount（家长账号）

| Field          |         Type | Required | Notes                   |
| -------------- | -----------: | -------: | ----------------------- |
| household_id   | string(UUID) |      Yes | PK                      |
| wechat_openid  |       string |      Yes | Unique per mini program |
| phone_optional |       string |       No | Optional if collected   |
| created_at     |     datetime |      Yes |                         |
| updated_at     |     datetime |      Yes |                         |

---

## 2) TeacherAccount（老师账号）

| Field         |         Type | Required | Notes                  |
| ------------- | -----------: | -------: | ---------------------- |
| teacher_id    | string(UUID) |      Yes | PK                     |
| wechat_openid |       string |      Yes | Unique; used for login |
| display_name  |       string |       No |                        |
| created_at    |     datetime |      Yes |                        |
| updated_at    |     datetime |      Yes |                        |

---

## 3) MusicClass（机构/老师档案，对应“机构”）

> Source: 报名机构列表.xls

| Field                     |         Type | Required | Notes                                  |
| ------------------------- | -----------: | -------: | -------------------------------------- |
| class_id                  | string(UUID) |      Yes | PK                                     |
| teacher_id                | string(UUID) |       No | FK (optional MVP; can be admin-seeded) |
| legacy_org_id             |          int |      Yes | **Excel: 报名机构ID**                      |
| name                      |       string |      Yes | Join key to RegistrationRecord “机构”    |
| principal_name_optional   |       string |       No | Excel: 集体老师姓名 (if used)                |
| contact_phone_optional    |       string |       No | Excel: 集体老师联系电话 (if used)              |
| default_site_id_optional  |          int |       No | Excel: 报名点ID default (optional)        |
| address_optional          |       string |       No | Ops only                               |
| permissions_json_optional |         json |       No | Parsed list from “权限”                  |
| wechat_bound_optional     |         bool |       No | Ops flag                               |
| created_at                |     datetime |      Yes |                                        |
| updated_at                |     datetime |      Yes |                                        |

---

## 4) LearnerProfile（学生档案/主数据）

| Field                        |         Type | Required | Notes                      | Excel |
| ---------------------------- | -----------: | -------: | -------------------------- | ----: |
| learner_id                   | string(UUID) |      Yes | PK                         |    No |
| household_id                 | string(UUID) |      Yes | FK → HouseholdAccount      |    No |
| legacy_candidate_id_optional |   int/string |       No | From old systems if needed |    No |
| name_cn                      |       string |      Yes | Excel: 姓名                  |   Yes |
| name_en_optional             |       string |       No | Excel: 拼音或英文               |   Yes |
| gender                       |         enum |      Yes | {男, 女}                     |   Yes |
| dob                          |         date |      Yes | Excel: 出生日期                |   Yes |
| nationality                  |       string |      Yes | Default 中国                 |   Yes |
| ethnicity_optional           |       string |       No | Excel: 民族                  |   Yes |
| id_type                      |         enum |      Yes | Excel: 证件类型                |   Yes |
| id_number_encrypted          |       string |      Yes | Encrypted at rest          |   Yes |
| guardian_phone               |       string |      Yes | Excel: 联系电话                |   Yes |
| mailing_address_optional     |       string |       No | Excel: 邮寄地址                |   Yes |
| recipient_name_optional      |       string |       No | Excel: 收件人                 |   Yes |
| recipient_phone_optional     |       string |       No | Excel: 收件电话                |   Yes |
| status                       |         enum |      Yes | {Active, Inactive}         |    No |
| created_at                   |     datetime |      Yes |                            |    No |
| updated_at                   |     datetime |      Yes |                            |    No |

### LearnerProfile Attachments (Attachment.owner_type="LearnerProfile")

* `portrait_photo`（彩照） — **Lock gate required**
* `id_front`（证照正面） — optional MVP

---

## 5) ExamSubject（专业字典）

> Source: 专业列表.xls + 报名简章规则

| Field                |   Type | Required | Notes                                           |
| -------------------- | -----: | -------: | ----------------------------------------------- |
| subject_id           |    int |      Yes | PK (or internal UUID + legacy id if you prefer) |
| subject_name         | string |      Yes | Excel: 报考专业 values must match                   |
| max_level            |    int |      Yes | Validation gate for RegistrationRecord.level    |
| sort_weight_optional |    int |       No | UI sorting                                      |
| is_active            |   bool |      Yes |                                                 |

---

## 6) ExamLevel（级别字典）

> Source: 级别列表.xls

| Field               |   Type | Required | Notes         |
| ------------------- | -----: | -------: | ------------- |
| level_value         |    int |      Yes | 1–11          |
| level_name          | string |      Yes | 11=演奏级        |
| unit_price_optional |    int |       No | Payment later |

---

## 7) RegistrationRecord（报名记录：1条=1个专业报考）

| Field                           |         Type |      Required | Notes                                         |    Excel |
| ------------------------------- | -----------: | ------------: | --------------------------------------------- | -------: |
| reg_id                          | string(UUID) |           Yes | PK                                            |       No |
| learner_id                      | string(UUID) |           Yes | FK → LearnerProfile                           |       No |
| class_id                        | string(UUID) |           Yes | FK → MusicClass                               | Indirect |
| legacy_reg_id_optional          |          int |            No | Old system ID                                 |       No |
| cycle_id                        |       string |           Yes | Exam cycle label                              |       No |
| subject_id                      |          int |           Yes | FK → ExamSubject                              |       No |
| instrument                      |       string |           Yes | Redundant display name (subject_name)         |      Yes |
| level                           |          int |           Yes | Must satisfy `level ≤ ExamSubject.max_level`  |      Yes |
| exam_site_id_optional           |          int |            No | Excel: 报名点ID                                  |      Yes |
| exam_mode                       |         enum |           Yes | Excel: 考试方式（现场/视频/音基）                         |      Yes |
| exam_submission_status_optional |         enum |            No | e.g., 未提交/已提交/初审通过…                           |       No |
| application_status              |         enum |           Yes | Excel: 报考状态（未申请/审核中/审核通过）                     |      Yes |
| workflow_status                 |         enum |           Yes | Draft/Submitted/NeedsChanges/Confirmed/Locked |       No |
| repertoire_json_optional        |         json |            No | 曲目1–4                                         |      Yes |
| teacher_notes_optional          |       string |            No | Used when NeedsChanges                        |       No |
| snapshot_json_optional          |         json | Yes (at Lock) | Source of truth for export                    |      Yes |
| submitted_at_optional           |     datetime |            No |                                               |          |
| reviewed_at_optional            |     datetime |            No |                                               |          |
| locked_at_optional              |     datetime |            No |                                               |          |
| created_at                      |     datetime |           Yes |                                               |          |
| updated_at                      |     datetime |           Yes |                                               |          |

### RegistrationRecord Attachments (optional, MVP)

If you decide to attach registration-specific materials (not required for export v2.1):

* `owner_type="RegistrationRecord"` for e.g., repertoire proof, additional docs.

---

## 8) ExamRecord（国音档案记录，归档摘要）

| Field                   |         Type | Required | Notes                        |
| ----------------------- | -----------: | -------: | ---------------------------- |
| examrec_id              | string(UUID) |      Yes | PK                           |
| learner_id              | string(UUID) |      Yes | FK                           |
| board_name              |       string |      Yes | Default 国音                   |
| cycle_text              |       string |      Yes | e.g., 2025寒假                 |
| subject_id_optional     |          int |       No | Optional link to ExamSubject |
| instrument              |       string |      Yes |                              |
| level                   |          int |      Yes |                              |
| result                  |         enum |      Yes | 合格/不合格/无成绩                   |
| certificate_no_optional |       string |       No |                              |
| recorded_at             |     datetime |      Yes | When saved                   |
| created_at              |     datetime |      Yes |                              |
| updated_at              |     datetime |      Yes |                              |

### ExamRecord Attachments

* `owner_type="ExamRecord"`; screenshots / PDFs.

---

## 9) Certification（证书实体，独立）

| Field                        |            Type | Required | Notes                            |
| ---------------------------- | --------------: | -------: | -------------------------------- |
| cert_id                      |    string(UUID) |      Yes | PK                               |
| learner_id                   |    string(UUID) |      Yes | FK                               |
| subject_id                   |             int |      Yes | FK → ExamSubject                 |
| subject_name                 |          string |      Yes | Redundant for history            |
| cert_level                   |             int |      Yes | 1–11                             |
| obtained_year_month          | string(YYYY-MM) |      Yes | Month picker                     |
| committee_name_optional      |          string |       No | 考级委员会名称                          |
| certificate_no               |          string |      Yes | Unique (recommend unique index)  |
| confirm_status               |            enum |      Yes | Unreviewed / TeacherConfirmed    |
| source                       |            enum |      Yes | ManualUpload / GuoyinArchiveSave |
| verification_status_optional |            enum |       No | Unverified / Verified / Invalid  |
| created_at                   |        datetime |      Yes |                                  |
| updated_at                   |        datetime |      Yes |                                  |

### Certification Attachments

* `owner_type="Certification"`, `file_type="certificate_photo"`.

---

## 10) Attachment（统一附件表）

| Field                  |         Type | Required | Notes                                                            |
| ---------------------- | -----------: | -------: | ---------------------------------------------------------------- |
| file_id                | string(UUID) |      Yes | PK                                                               |
| owner_type             |         enum |      Yes | LearnerProfile / RegistrationRecord / ExamRecord / Certification |
| owner_id               | string(UUID) |      Yes |                                                                  |
| file_type              |         enum |      Yes | See enum list below                                              |
| storage_url            |       string |      Yes | Object storage path                                              |
| uploaded_by_actor_type |         enum |       No | Parent/Teacher/System                                            |
| uploaded_by_actor_id   |       string |       No | Optional                                                         |
| uploaded_at            |     datetime |      Yes |                                                                  |

---

## 11) AuditLog（审计日志，MVP必做）

| Field              |         Type | Required | Notes                                                   |
| ------------------ | -----------: | -------: | ------------------------------------------------------- |
| audit_id           | string(UUID) |      Yes | PK                                                      |
| entity_type        |       string |      Yes | LearnerProfile/RegistrationRecord/Certification…        |
| entity_id          |       string |      Yes |                                                         |
| actor_type         |         enum |      Yes | Parent/Teacher/System                                   |
| actor_id           |       string |      Yes | household_id/teacher_id/system                          |
| action             |         enum |      Yes | e.g., REQUEST_CHANGES, CONFIRM, LOCK, UNLOCK, REVEAL_ID |
| diff_json_optional |         json |       No | Field-level changes                                     |
| created_at         |     datetime |      Yes |                                                         |

---

## 12) ExportLog（导出记录，建议MVP加入）

| Field            |         Type | Required | Notes                    |
| ---------------- | -----------: | -------: | ------------------------ |
| export_id        | string(UUID) |      Yes | PK                       |
| class_id         | string(UUID) |      Yes | 机构                       |
| cycle_id         |       string |      Yes | 考期                       |
| template_version |       string |      Yes | v2.1                     |
| record_count     |          int |      Yes | Locked rows exported     |
| file_storage_url |       string |      Yes | Where the XLSX is stored |
| actor_teacher_id | string(UUID) |      Yes | Who exported             |
| created_at       |     datetime |      Yes |                          |

---

# Enums (Canonical)

## Registration workflow

* `workflow_status`: Draft / Submitted / NeedsChanges / Confirmed / Locked

## Excel 报考状态

* `application_status`: 未申请 / 审核中 / 审核通过

## 考试方式

* `exam_mode`: 现场 / 视频 / 音基

  * Rule: subject=音乐基础知识 ⇒ forced 音基

## Exam result

* `exam_result` / `ExamRecord.result`: 无成绩 / 合格 / 不合格

## Certification

* `confirm_status`: Unreviewed / TeacherConfirmed
* `source`: ManualUpload / GuoyinArchiveSave
* `verification_status_optional`: Unverified / Verified / Invalid

## Attachment file types

* `portrait_photo` (彩照)
* `id_front` (证照正面)
* `certificate_photo` (证书照片)
* `archive_screenshot` (国音查询截图)
* `other`

## Actor types (Audit/Attachment)

* Parent / Teacher / System

---

# snapshot_json (Lock-time export source of truth)

At **LOCK**, write a snapshot containing exactly what export needs (template v2.1), plus metadata:

```json
{
  "template_version": "v2.1",
  "cycle_id": "2026寒假",

  "legacy_org_id": 2,
  "exam_site_id_optional": "",

  "name_cn": "王槿妤",
  "name_en_optional": "Wang Jin Yu",
  "gender": "女",
  "nationality": "中国",
  "ethnicity_optional": "汉族",

  "id_type": "身份证",
  "id_number_plaintext": "XXXXXXXXXXXXXXXXXX",
  "guardian_phone": "138XXXXXXXX",

  "dob": "2015-07-22",

  "mailing_address_optional": "",
  "recipient_name_optional": "",
  "recipient_phone_optional": "",

  "instrument": "钢琴",
  "subject_id": 15,
  "level": 8,

  "repertoire": ["曲目1", "曲目2", "", ""],

  "teacher_name_optional": "张三",
  "teacher_phone_optional": "139XXXXXXXX",

  "exam_mode": "视频",
  "application_status": "审核通过",

  "risk_flags": []
}
```

**Lock gate requirement:** `portrait_photo` must exist on LearnerProfile.

---

If you want, I can now convert this Field Dictionary into the updated **ERD Mermaid** (one canonical ERD block reflecting the new `workflow_status` vs `application_status` split) so the diagrams and spec remain perfectly synchronized.

