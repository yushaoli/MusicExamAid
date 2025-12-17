Understood — that changes the relationship model materially.

If **MusicClass = institution (报名机构/工作室)** and **one institution has multiple teachers**, then the earlier “MusicClass ↔ TeacherAccount (1:1)” simplification is no longer correct. We should refactor to introduce a **TeacherProfile** entity (a teacher within an institution) and optionally an **InstitutionEnrollment** entity (student ↔ institution binding independent of registrations).

Below is the refactor proposal and an updated canonical ERD.

---

## Refactor plan (high level)

### Refactor 1 — Keep `MusicClass`, redefine it clearly as Institution

* `MusicClass` becomes the **institution** object (报名机构/工作室).
* Institution-level fields remain here: `legacy_org_id`, `name`, default contact, default site id, address, etc.

### Refactor 2 — Add `TeacherProfile` (teacher belongs to an institution)

* Each teacher is a **person** under one institution: `TeacherProfile.class_id → MusicClass.class_id`.
* The WeChat login identity (`TeacherAccount`) binds to one or more `TeacherProfile` records (for multi-institution teachers later).

### Refactor 3 — Add `InstitutionEnrollment` (recommended for clean permissions)

* If teachers can “view/edit/confirm student profiles,” you usually need a stable roster even before/without a specific registration record.
* `InstitutionEnrollment` links `LearnerProfile` to `MusicClass` with `consent_status`.
* Teacher roster can then be driven by enrollments + filter by cycle, rather than only registrations.

### Refactor 4 — Add `registration_teacher_id_optional` to RegistrationRecord (optional, but useful)

* Since multiple teachers exist, you may want to assign a registration to a specific teacher for review/lock/export accountability.
* Export “集体老师姓名/联系电话” can come from:

  * assigned teacher (preferred), or
  * institution default contact (fallback).

---

## Canonical ERD (v2.1 — Institution + Multi-teacher)

The error persists because your Mermaid environment strictly forbids **inline comments** (placing `%%` on the same line as code).

I have moved every comment to the **line above** its attribute. This makes the code valid and robust for all editors.

```mermaid
erDiagram
    %% --- RELATIONSHIPS ---
    HouseholdAccount ||--o{ LearnerProfile : owns

    %% Institution
    MusicClass ||--o{ TeacherProfile : has
    MusicClass ||--o{ RegistrationRecord : tracks
    MusicClass ||--o{ InstitutionEnrollment : enrolls
    MusicClass ||--o{ ExportLog : exports

    %% Teacher identity bindings
    TeacherAccount ||--o{ TeacherProfileBinding : binds
    TeacherProfile ||--o{ TeacherProfileBinding : maps

    %% Learner links
    LearnerProfile ||--o{ InstitutionEnrollment : joins
    LearnerProfile ||--o{ RegistrationRecord : registers
    LearnerProfile ||--o{ ExamRecord : archives
    LearnerProfile ||--o{ Certification : owns

    %% Optional assignment of registrations to a specific teacher
    TeacherProfile ||--o{ RegistrationRecord : reviews

    %% Dictionaries
    ExamSubject ||--o{ RegistrationRecord : governs
    ExamSubject ||--o{ Certification : categorizes

    %% Attachments (polymorphic)
    LearnerProfile ||--o{ Attachment : stores
    RegistrationRecord ||--o{ Attachment : contains
    ExamRecord ||--o{ Attachment : includes
    Certification ||--o{ Attachment : includes

    %% Audit
    RegistrationRecord ||--o{ AuditLog : triggers
    LearnerProfile ||--o{ AuditLog : triggers
    Certification ||--o{ AuditLog : triggers

    %% --- ENTITIES ---
    HouseholdAccount {
        string household_id PK
        string wechat_openid
        string phone_optional
        datetime created_at
        datetime updated_at
    }

    LearnerProfile {
        string learner_id PK
        string household_id FK

        int legacy_candidate_id_optional

        string name_cn
        string name_en_optional
        string gender
        date dob

        string nationality
        string ethnicity_optional

        string id_type
        string id_number_encrypted
        string guardian_phone

        string mailing_address_optional
        string recipient_name_optional
        string recipient_phone_optional

        string status
        datetime created_at
        datetime updated_at
    }

    %% Institution (报名机构/工作室)
    MusicClass {
        string class_id PK

        %% Excel: 报名机构ID
        int legacy_org_id
        %% Excel: 二级机构名称
        string name

        %% Excel: 报名点ID default (optional)
        int default_site_id_optional
        string default_contact_name_optional
        string default_contact_phone_optional

        string address_optional
        string permissions_json_optional
        boolean wechat_bound_optional

        datetime created_at
        datetime updated_at
    }

    %% Teacher under an institution
    TeacherProfile {
        string teacher_profile_id PK
        %% belongs to MusicClass (institution)
        string class_id FK

        string teacher_name
        string teacher_phone_optional

        %% Admin/Reviewer/Assistant (suggested)
        string role
        %% simple permission flag (or role-based)
        boolean can_export_optional

        datetime created_at
        datetime updated_at
    }

    %% WeChat identity
    TeacherAccount {
        string teacher_id PK
        string wechat_openid
        string display_name_optional
        datetime created_at
        datetime updated_at
    }

    %% Binding table (supports 1 teacher account -> multiple teacher profiles)
    TeacherProfileBinding {
        string binding_id PK
        string teacher_id FK
        string teacher_profile_id FK
        datetime created_at
    }

    %% Learner <-> Institution membership (clean roster + permission boundary)
    InstitutionEnrollment {
        string enrollment_id PK
        string class_id FK
        string learner_id FK

        %% Pending/Granted/Revoked
        string consent_status
        datetime created_at
        datetime updated_at
    }

    ExamSubject {
        int subject_id PK
        string subject_name
        int max_level
        int sort_weight_optional
        boolean is_active
    }

    ExamLevel {
        int level_value PK
        string level_name
        int unit_price_optional
    }

    RegistrationRecord {
        string reg_id PK
        string learner_id FK
        string class_id FK

        string cycle_id
        int subject_id FK
        string instrument
        int level

        int exam_site_id_optional

        string exam_mode
        string exam_submission_status_optional

        %% Excel: 报考状态
        string application_status
        %% Draft/Submitted/NeedsChanges/Confirmed/Locked
        string workflow_status

        string repertoire_json_optional
        string teacher_notes_optional

        %% assignment for review/export attribution
        string teacher_profile_id_optional

        %% written at Lock; export source of truth
        string snapshot_json_optional

        datetime submitted_at_optional
        datetime reviewed_at_optional
        datetime locked_at_optional
        datetime created_at
        datetime updated_at
    }

    ExamRecord {
        string examrec_id PK
        string learner_id FK

        string board_name
        string cycle_text

        int subject_id_optional
        string instrument
        int level

        string result
        string certificate_no_optional

        datetime recorded_at
        datetime created_at
        datetime updated_at
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
        string verification_status_optional

        datetime created_at
        datetime updated_at
    }

    Attachment {
        string file_id PK
        string owner_type
        string owner_id
        string file_type
        string storage_url

        string uploaded_by_actor_type_optional
        string uploaded_by_actor_id_optional
        datetime uploaded_at
    }

    AuditLog {
        string audit_id PK
        string entity_type
        string entity_id
        string actor_type
        string actor_id
        string action
        string diff_json_optional
        datetime created_at
    }

    ExportLog {
        string export_id PK
        string class_id FK
        string cycle_id
        string template_version
        int record_count
        string file_storage_url
        string actor_teacher_id
        datetime created_at
    }
```

---

## What this refactor changes in the product behavior

1. **Teacher permissions become institution-scoped**

* A teacher (TeacherAccount) can see students/registrations for the institution(s) they are bound to via `TeacherProfileBinding`.

2. **Roster becomes stable and correct**

* Teachers can view/confirm student profiles even before a specific registration exists because the student is enrolled to the institution via `InstitutionEnrollment`.

3. **Export attribution is unambiguous**

* Export is still by institution + cycle, but the reviewing teacher can be tracked per registration via `teacher_profile_id_optional` and/or via `ExportLog.actor_teacher_id`.

---

If you agree with this direction, the next necessary refactor is to update **Task #2 Field Dictionary** entries for:

* `TeacherProfile`, `TeacherProfileBinding`, and `InstitutionEnrollment`
* and update **Task #3 Excel mapping** to decide whether “集体老师姓名/联系电话” comes from **TeacherProfile** (assigned) or **MusicClass defaults** (fallback).
