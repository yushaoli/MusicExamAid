# MVP v2.2.1 Implementation Guide

## Project Structure

```
MusicExamAid/
├── miniprogram/
│   ├── app.js                    # App entry, cloud init, auth
│   ├── app.json                  # Pages config, tabBar
│   ├── utils/
│   │   └── api.js                # Cloud function API wrapper
│   └── pages/
│       ├── index/                # Home page
│       ├── learner/list|edit/    # Parent: learner management
│       ├── enrollment/select/    # Parent: institution selection
│       ├── registration/list|edit|detail/  # Parent: registration
│       ├── me/                   # Profile + role-based menu
│       ├── teacher/roster|review/  # Teacher console
│       ├── admin/batches|batch-detail/  # Institution admin
│       └── super/incoming|batch|export/  # Super institution
├── cloudfunctions/
│   ├── shared/                   # RBAC helpers, encryption, utils
│   ├── authLogin/                # Auth + session
│   ├── learnerList|Get|Upsert/   # Parent learner APIs
│   ├── enrollmentCreateOrUpdate/ # Enrollment API
│   ├── registrationCreate|Update|Submit/  # Registration APIs
│   ├── attachmentCommit/         # Attachment metadata
│   ├── teacherRosterList|Confirm|Lock|Unlock|RequestChanges|SubmitToInstitution/
│   ├── instBatchCreate|AddItems|RemoveItems|Preflight|SubmitToSuper/
│   └── superBatchCreate|IngestInstitutionBatches|DedupRun|ResolveConflict|Preflight|ExportOnce/
└── scripts/
    └── db_setup.js               # Seed dict_subjects, dict_cycles
```

## Database Setup

### Collections to Create (via Cloud Console)

1. `households` - { _id, openid, created_at }
2. `learners` - with index on `household_id`
3. `institutions` - { _id, name, legacy_org_id, created_at }
4. `teacher_accounts` - { _id, openid, created_at }
5. `teacher_profiles` - indexes on `class_id`, `teacher_account_id`, `role`
6. `enrollments` - unique index on `learner_id + class_id`
7. `registrations` - indexes on `class_id+cycle_id+workflow_status`, `learner_id+cycle_id`
8. `attachments` - index on `owner_type + owner_id`
9. `audit_logs`
10. `institution_batches`
11. `institution_batch_items`
12. `super_batches`
13. `super_batch_items`
14. `export_logs`
15. `dict_subjects`
16. `dict_cycles`

### Seed Data

Deploy `scripts/db_setup.js` as cloud function and run once to seed:
- 11 subjects (piano, violin, guzheng, etc.)
- 4 cycles (2025 spring/summer/fall/winter)

## Environment Variables

Set in Cloud Console for each function:
- `ENCRYPTION_KEY` - 32-char key for ID encryption
- `TEMPLATE_FILE_ID` - Cloud storage fileID for Excel template v2.1

## Deployment Steps

1. **Create Cloud Environment** in WeChat DevTools
2. **Create Collections** with indexes via Cloud Console
3. **Deploy Cloud Functions** one by one (right-click → upload)
4. **Run db_setup** to seed dictionaries
5. **Upload Template** v2.1 XLSX to cloud storage, note fileID
6. **Configure env vars** for superBatchExportOnce
7. **Test auth flow** - open mini program, verify household created

## Acceptance Criteria

### Parent Flow
- [ ] Can create/edit learner with encrypted ID storage
- [ ] Can select institution and create enrollment
- [ ] Can create registration with subject/level/repertoire
- [ ] Can submit registration for teacher review
- [ ] Cannot edit after submission (unless NeedsChanges)

### Teacher Flow
- [ ] Can view roster filtered by class/cycle/status
- [ ] Can request changes (sets NeedsChanges + notes)
- [ ] Can confirm submitted registration
- [ ] Can lock confirmed registration (requires portrait_photo)
- [ ] Lock writes snapshot_json with decrypted ID
- [ ] Can submit locked registration to institution

### Institution Admin Flow
- [ ] Can create institution batch for cycle
- [ ] Can add eligible registrations (Locked + SubmittedToInstitution)
- [ ] Can run preflight validation
- [ ] Can submit batch to super

### Super Flow
- [ ] Can view incoming institution batches
- [ ] Can create super batch and ingest institution batches
- [ ] Dedup auto-excludes same-level duplicates
- [ ] Can manually resolve different-level conflicts
- [ ] Can run preflight
- [ ] Export generates XLSX from snapshot_json only
- [ ] Export is one-time (status=Exported blocks re-export)

## E2E Test Plan

### Scenario: Full Workflow

1. **Parent creates learner**
   - POST learnerUpsert with all fields including id_number
   - Verify id_number_encrypted stored, id_last4 correct
   - GET learnerGet returns masked data (no plaintext ID)

2. **Parent enrolls in institution**
   - POST enrollmentCreateOrUpdate with consent_status=Granted

3. **Parent creates registration**
   - POST registrationCreate with cycle_id, subject_id, level
   - Verify workflow_status=Draft

4. **Parent uploads portrait photo**
   - wx.cloud.uploadFile to get fileID
   - POST attachmentCommit with file_type=portrait_photo

5. **Parent submits**
   - POST registrationSubmit
   - Verify workflow_status=Submitted

6. **Teacher confirms**
   - POST teacherConfirm
   - Verify workflow_status=Confirmed

7. **Teacher locks**
   - POST teacherLock
   - Verify workflow_status=Locked
   - Verify snapshot_json contains decrypted id_number_plaintext
   - Verify locked_at set

8. **Teacher submits to institution**
   - POST teacherSubmitToInstitution
   - Verify handoff_status=SubmittedToInstitution

9. **Admin creates batch**
   - POST instBatchCreate
   - POST instBatchAddItems with reg_id
   - Verify handoff_status=IncludedInInstitutionBatch

10. **Admin submits to super**
    - POST instBatchSubmitToSuper
    - Verify inst_batch_status=SubmittedToSuper

11. **Super ingests**
    - POST superBatchCreate
    - POST superBatchIngestInstitutionBatches
    - Verify super_batch_items created with dedup_key

12. **Super runs dedup**
    - POST superBatchDedupRun
    - Verify auto-resolution for same-level duplicates

13. **Super exports**
    - POST superBatchExportOnce
    - Verify XLSX generated with correct headers
    - Verify ID/phone as text (no scientific notation)
    - Verify DOB as YYYY-MM-DD
    - Verify export_logs created
    - Verify super_batch_status=Exported

14. **Verify export idempotency**
    - POST superBatchExportOnce again
    - Should return error ALREADY_EXPORTED

## Security Checklist

- [x] All cloud functions use getAuthContext() for RBAC
- [x] Parents can only access own household's learners
- [x] Teachers can only access their assigned classes
- [x] Admin functions require Admin role
- [x] Super functions require Super role
- [x] ID numbers encrypted at rest, decrypted only in snapshot
- [x] Client never receives plaintext ID (only last4)
- [x] Audit logs for sensitive operations (lock/unlock)

