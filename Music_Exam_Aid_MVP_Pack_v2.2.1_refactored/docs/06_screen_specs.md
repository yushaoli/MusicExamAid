# Screen Specs — TA1/TA2 + S1/S2/S3 (MVP v2.2.1)

## TA1 Institution Batch List
- Role gate: TeacherProfile.role==Admin OR can_export_optional==true
- Filters: cycle_id required, inst_batch_status
- Actions: create batch, open batch, submit to super

## TA2 Institution Batch Detail
- Add items: workflow_status=Locked AND handoff_status=SubmittedToInstitution
- On add: handoff_status=IncludedInInstitutionBatch
- Preflight: validate without XLSX
- Submit: inst_batch_status=SubmittedToSuper

## S2 SuperBatch Builder
- Dedup key: learner_id|cycle_id|subject_id
- Auto keep newest locked_at for same level duplicates
- Manual conflicts: level mismatch/cross-institution collision

## S3 Export Once
- Export from SuperBatch only
- Use template-order header-driven mapping
