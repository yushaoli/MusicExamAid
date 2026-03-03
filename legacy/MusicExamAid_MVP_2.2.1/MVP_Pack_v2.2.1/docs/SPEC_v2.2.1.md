# Music Exam Aid — Master Spec (MVP v2.2.1)

Generated: 2025-12-17 08:26:30

## 0. Document set
This master spec consolidates the following into one implementation-ready view:
- Product overview + personas
- IA + key user journeys
- ERD v2.2 (conceptual) and workflow states
- Console model (Teacher / Institution Admin / Super Institution)
- Export (Template v2.1) strict header-driven mapping
- Build sequence (Cursor-ready MVP)

---

## 1) Product scope

**Product:** WeChat Mini Program “考级助手 / Music Exam Aid”

**Core MVP goal:** Provide an operationally reliable, low-friction workflow for exam registrations:
Parent → Teacher review/lock → Institution aggregation → Super Institution export (one-time).

**Out of scope (MVP):** WeChat Pay; automated 国音 scraping/sync; full LMS; direct official system submission.

---

## 2) Personas

### Parent (HouseholdAccount)
- Owns WeChat login
- Manages learner profile + sensitive fields + attachments (彩照)
- Creates registrations per cycle/subject/level
- Submits registrations for teacher review
- Maintains Archive (国音 WebView + manual save) and Certifications

### Student
- Uses parent’s device to practice:
  - 音乐基础知识
  - 乐器陪练
  - 水平评估

### Teacher (TeacherProfile)
- Reviews registrations in institution scope
- Requests changes / confirms / locks
- Submits locked registrations to institution admin

### Institution Admin (TeacherProfile.role==Admin)
- Creates InstitutionBatch per cycle
- Adds/removes items
- Preflight checks
- Submits batch to Super Institution

### Super Institution Operator
- Ingests InstitutionBatches
- Builds SuperBatch
- Resolves conflicts/dedup
- Exports once (Template v2.1)

---

## 3) Information architecture

### Parent tabs
- 练习 Practice
- 考级 Exam (Registration + Archive + Certification)
- 进度 Progress
- 我的 Me

### Back-office
- Teacher Console: T0/T1/T2 + TA1/TA2 (Admin)
- Super Console: S1/S2/S3

---

## 4) Core workflow

### 4.1 Registration workflow_status
Draft → Submitted → NeedsChanges → Confirmed → Locked

Rules:
- Parent edits only Draft/NeedsChanges
- Teacher confirms then locks
- Lock writes `snapshot_json` (export uses snapshot only)
- 彩照 is required at Lock and stored as Attachment

### 4.2 Handoff workflow (handoff_status)
None → SubmittedToInstitution → IncludedInInstitutionBatch → IncludedInSuperBatch

Rules:
- Teacher “submit-to-institution” requires Locked
- InstitutionBatch only accepts SubmittedToInstitution
- SuperBatch only accepts IncludedInInstitutionBatch items that are Locked + have snapshot

---

## 5) Dedup and conflicts (SuperBatch)

**Dedup key:** learner_id + cycle_id + subject_id

Handling:
- Same key, same level: auto keep newest locked_at; exclude older
- Same key, different level: manual conflict resolution required
- Cross-institution collision: manual resolution required

---

## 6) Export (Template v2.1)

**Export unit:** SuperBatch only.

**Strict header-driven mapping:**
1) Load template workbook (v2.1)
2) Read header row left→right (header order is stable)
3) For each SuperBatchItem (reg snapshot), write values into existing columns by header name
4) Never add/reorder columns
5) Keep styles and validations intact

Formatting rules:
- ID / phone: write as text (avoid scientific notation)
- DOB: normalize to YYYY-MM-DD (text)
- Repertoire: pad to 4 items

---

## 7) Screen inventory

### Parent
- Learner list / create / edit
- Enrollment to institution
- Registration list / create / edit / submit / status tracking
- Archive (国音 WebView + manual save)
- Certification (lightweight)

### Teacher + Admin
- T0 select TeacherProfile
- T1 roster list (filters by cycle/status/subject/level; only_issues)
- T2 registration review panel (request changes / confirm / lock / unlock / submit-to-institution)
- TA1 InstitutionBatches list
- TA2 InstitutionBatch detail (add/remove, preflight, submit-to-super)

### Super
- S1 incoming InstitutionBatches
- S2 SuperBatch builder (ingest + dedup + resolve conflicts + preflight)
- S3 export once

---

## 8) Build sequence (Cursor MVP)

1) DB migrations for v2.2 entities + dictionary ingestion (subjects/levels/cycles)
2) Parent: learner + enrollment + registration (draft/edit/submit)
3) Teacher: roster + review + request changes + confirm + lock + submit-to-institution
4) Institution Admin: batches (TA1/TA2) + submit-to-super
5) Super: ingest + SuperBatch builder + dedup/conflicts + preflight
6) Exporter: Template v2.1 strict header mapping + ExportLog
7) Archive/Certification: stubs or partial implementation
