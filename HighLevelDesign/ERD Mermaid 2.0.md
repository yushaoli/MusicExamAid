Understood. Below is the **updated canonical ERD Mermaid** reflecting Task #2 v2.0, including the critical refactor:

* `RegistrationRecord.workflow_status` vs `RegistrationRecord.application_status`
* `MusicClass.legacy_org_id` as the export anchor for “报名机构ID”
* Attachments linked to **LearnerProfile / RegistrationRecord / ExamRecord / Certification**
* Optional `ExportLog` entity (recommended MVP)
* I keep your comment/section conventions and naming stability.

---

## Canonical ERD (v2.0)

```mermaid
erDiagram
    %% --- RELATIONSHIPS ---
    HouseholdAccount ||--o{ LearnerProfile : owns

    TeacherAccount ||--o{ MusicClass : binds
    MusicClass ||--o{ RegistrationRecord : tracks

    ExamSubject ||--o{ RegistrationRecord : governs
    ExamSubject ||--o{ Certification : categorizes

    LearnerProfile ||--o{ RegistrationRecord : registers
    LearnerProfile ||--o{ ExamRecord : archives
    LearnerProfile ||--o{ Certification : owns

    %% Attachments (polymorphic)
    LearnerProfile ||--o{ Attachment : stores
    RegistrationRecord ||--o{ Attachment : contains
    ExamRecord ||--o{ Attachment : includes
    Certification ||--o{ Attachment : includes

    %% Audit + Export
    RegistrationRecord ||--o{ AuditLog : triggers
    LearnerProfile ||--o{ AuditLog : triggers
    Certification ||--o{ AuditLog : triggers
    MusicClass ||--o{ ExportLog : exports

    %% --- ENTITIES ---
    HouseholdAccount {
        string household_id PK
        string wechat_openid
        string phone_optional
        datetime created_at
        datetime updated_at
    }

    TeacherAccount {
        string teacher_id PK
        string wechat_openid
        string display_name_optional
        datetime created_at
        datetime updated_at
    }

    MusicClass {
        string class_id PK
        string teacher_id FK

        %% Excel: 报名机构ID
        int legacy_org_id
        %% Excel: 二级机构名称
        string name

        %% Excel: 集体老师姓名
        string principal_name_optional
        %% Excel: 集体老师联系电话
        string contact_phone_optional
        %% Excel: 报名点ID (optional default)
        int default_site_id_optional

        string address_optional
        string permissions_json_optional
        boolean wechat_bound_optional

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

        %% redundant subject_name for export/display
        string instrument
        int level

        int exam_site_id_optional

        %% 现场/视频/音基
        string exam_mode
        string exam_submission_status_optional

        %% Excel: 报考状态 (未申请/审核中/审核通过)
        string application_status
        %% Draft/Submitted/NeedsChanges/Confirmed/Locked
        string workflow_status

        string repertoire_json_optional

        string teacher_notes_optional

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

        %% 合格/不合格/无成绩
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

        %% Unreviewed/TeacherConfirmed
        string confirm_status
        %% ManualUpload/GuoyinArchiveSave
        string source
        string verification_status_optional

        datetime created_at
        datetime updated_at
    }

    Attachment {
        string file_id PK
        %% LearnerProfile/RegistrationRecord/ExamRecord/Certification
        string owner_type
        string owner_id
        %% portrait_photo/id_front/certificate_photo/archive_screenshot/other
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

# Refactoring notes (what I expect you mean by “entity relationship refactor”)

Based on your latest constraints and the source files, there are two likely refactors worth doing now (before dev):

## Refactor A — Replace/avoid ClassEnrollment

Earlier we discussed `ClassEnrollment` and join codes, but your data reality says:

* `机构` maps directly to the teacher profile (`MusicClass`)
* Students don’t necessarily “enroll” via join code; teacher can view the students whose RegistrationRecord references their MusicClass

**Recommendation (MVP):** drop `ClassEnrollment` entirely.

* Teacher roster is driven by `RegistrationRecord.class_id`
* This matches your imported files and simplifies authorization.

If later you want stronger “teacher-student binding” outside registration, we can reintroduce enrollment as an optional layer.

## Refactor B — RegistrationRecord vs LearnerProfile “template fields”

Because export requires many learner fields, we should ensure **Lock writes snapshot_json** and export uses snapshot, not live profile.

We already reflected that. The operational question is:

* Do we ever need **multiple phone numbers** or **multiple ID documents** per learner?
  If yes, consider splitting “IdentityDocument” into its own table later. For MVP, keep it on LearnerProfile.

---

If you confirm Refactor A (dropping ClassEnrollment), I will update the earlier docs/diagrams to remove it and tighten the authorization model (“teacher can only see registrations under their MusicClass”).
