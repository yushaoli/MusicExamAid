Understood. Below is an updated **high-level design (HLD v1.1)** that incorporates the latest decisions:

* “机构” maps directly to **teacher profile (MusicClass)**
* 专业/级别 rule set comes from the **报名简章 / 专业字典（含max_level）**
* Certifications are a **separate entity** (detailed now, validation integration later)
* MVP remains: profile + registration + teacher review/lock + Excel export + 国音档案归档（辅助）

---

# High-Level Design v1.1 (MVP)

## 1) Product modules

### A. Practice 练习

1. **音乐基础知识**
2. **乐器陪练**
3. **水平评估**

> Practice is a separate module from registration. It writes to learner progress, not to registration export.

### B. Exam 考级

1. **报名信息（Registration）**
2. **考级档案（Archive）**

   * 国音成绩查询（WebView）
   * 国音证书查询（WebView）
   * 保存到档案（ExamRecord / Certification attachments）

### C. Teacher Console 老师端（limited）

* Roster (by 机构/MusicClass, cycle, status)
* Student detail tabs:

  * Profile（学生档案）
  * Registration（报名记录）
  * Archive（考级档案 / 证书）

### D. Export 导出

* Excel export from **Locked** RegistrationRecords only
* Uses **template v2.1 mapping**

---

## 2) Core data objects (HLD)

### HouseholdAccount（家长账号）

* WeChat identity container
* Owns multiple LearnerProfiles

### LearnerProfile（学生档案）

* Identity: name, gender, DOB, id_type/id_no, nationality/ethnicity, guardian phone
* Attachments: `portrait_photo(彩照)`, `id_front(证照正面)`

### MusicClass（机构/老师档案）

* Represents “机构” in RegistrationRecord
* Has `legacy_org_id` for Excel export

### RegistrationRecord（报考专业记录）

* One row = one subject application in a cycle
* Key: learner_id + cycle_id + subject/instrument
* Validated against ExamSubject(max_level) rules
* Status machine: Draft → Submitted → NeedsChanges → Confirmed → Locked
* Lock-time: write `snapshot_json` for stable export

### ExamSubject（专业字典）

* subject_name + max_level (from 专业列表/简章)
* Used for validation and dropdown

### Certification（证书，独立实体）

* subject + level + obtained_month + committee + certificate_no + attachments
* Later: can power prerequisite warnings (10/11级需音基3等)

### ExamRecord（国音档案记录，结构化归档）

* Optional, used to store query result summary + attachments

---

## 3) High-level flows

### 3.1 Parent flow (registration)

1. Create/maintain LearnerProfile + attachments
2. Create RegistrationRecord(s) for cycle:

   * Choose “机构(MusicClass)” (or assigned via join)
   * Choose 专业/级别 (validated by max_level)
3. Submit to teacher
4. Receive change request → edit → resubmit
5. Teacher locks → becomes exportable

### 3.2 Teacher flow

1. Filter roster by cycle/status/专业/级别
2. Open student detail:

   * Fix formatting errors
   * Confirm / request changes
   * Lock for export
3. Export Excel template

### 3.3 Archive flow (国音)

1. Open 国音 query page in WebView
2. User performs query and sees result
3. Save summary + upload attachment(s) into 考级档案
4. Teacher can view/confirm archive records (lightweight)

---

## 4) Rules that are “HLD-level” (not deep spec)

### 专业/级别

* Each subject has a max level:

  * 音基 1–6
  * Some instruments 1–9 / 1–10 / 1–11
* UI enforces allowed levels via dropdown filtered by subject.

### Export

* Only `Locked` records can be exported
* Export uses snapshot to avoid downstream profile edits breaking the batch

---

# Updated diagrams (Mermaid, consistent with your conventions)

## A) IA map (v1.1)

```mermaid
flowchart TB
  A[Mini Program] --> B[Practice 练习]
  A --> C[Exam 考级]
  A --> D[Progress 进度]
  A --> E[Me 我的]
  A --> T[Teacher Console 老师端]

  B --> B1[Music Knowledge 音乐基础知识]
  B --> B2[Instrument Coaching 乐器陪练]
  B --> B3[Assessment 水平评估]

  C --> C1[Registration 报名信息]
  C --> C2[Archive 考级档案]

  C1 --> C11[Cycle Selector 考期选择]
  C1 --> C12[Select MusicClass 选择机构/老师]
  C1 --> C13[Subject & Level 专业/级别]
  C1 --> C14[Submit to Teacher 提交老师]
  C1 --> C15[Status Tracking 状态跟踪]

  C2 --> C21[Open 国音成绩查询 WebView]
  C2 --> C22[Open 国音证书查询 WebView]
  C2 --> C23[Save Record 归档存证]

  T --> T1[Roster 学生列表]
  T --> T2[Student Detail 学生详情]
  T --> T3[Export 导出Excel]
```

## D) Registration status state machine (unchanged)

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: Parent submits to teacher
  Submitted --> NeedsChanges: Teacher requests changes
  NeedsChanges --> Submitted: Parent resubmits
  Submitted --> Confirmed: Teacher confirms
  Confirmed --> Locked: Teacher locks for export
  Locked --> Confirmed: Teacher unlocks (restricted)
```

## C) ERD (HLD subset, v1.1)

```mermaid
erDiagram
    %% --- RELATIONSHIPS ---
    HouseholdAccount ||--o{ LearnerProfile : owns
    TeacherAccount ||--o{ MusicClass : binds

    LearnerProfile ||--o{ RegistrationRecord : registers
    MusicClass ||--o{ RegistrationRecord : tracks

    ExamSubject ||--o{ RegistrationRecord : governs
    LearnerProfile ||--o{ Certification : owns
    Certification ||--o{ Attachment : includes
    LearnerProfile ||--o{ Attachment : stores

    %% --- ENTITIES ---
    HouseholdAccount {
        string household_id PK
        string wechat_openid
        datetime created_at
    }

    LearnerProfile {
        string learner_id PK
        string household_id FK
        string name_cn
        string name_en_optional
        string id_type
        string id_number_encrypted
        date dob
        string gender
        string nationality
        string ethnicity_optional
        string guardian_phone
        datetime created_at
        datetime updated_at
    }

    MusicClass {
        string class_id PK
        string teacher_id FK
        int legacy_org_id
        string name
        string principal_name_optional
        string contact_phone_optional
        datetime created_at
        datetime updated_at
    }

    ExamSubject {
        int subject_id PK
        string subject_name
        int max_level
        boolean is_active
    }

    RegistrationRecord {
        string reg_id PK
        string learner_id FK
        string class_id FK
        string cycle_id
        int subject_id FK
        string instrument
        int level
        string exam_mode
        string status
        string repertoire_json
        string snapshot_json
        datetime locked_at
    }

    Certification {
        string cert_id PK
        string learner_id FK
        int subject_id FK
        string subject_name
        int cert_level
        string obtained_year_month
        string committee_name_optional
        string certificate_no
        string confirm_status
        string source
        datetime created_at
        datetime updated_at
    }

    Attachment {
        string file_id PK
        string owner_type
        string owner_id
        string file_type
        string storage_url
        datetime uploaded_at
    }
```

---

If you want one more refinement at HLD level, the next best addition is a **single “System Context” diagram** (Mini Program ↔ Backend ↔ Storage ↔ Export service ↔ 国音 WebView) to make architecture and responsibilities explicit.
