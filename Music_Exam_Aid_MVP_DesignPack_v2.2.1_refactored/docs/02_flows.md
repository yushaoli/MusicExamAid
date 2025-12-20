# 02 Flows (MVP v2.2.1)

## Registration (Parent ↔ Teacher)
- Parent creates Draft
- Parent submits → Submitted
- Teacher requests changes → NeedsChanges
- Parent resubmits → Submitted
- Teacher confirms → Confirmed
- Teacher locks → Locked (writes snapshot_json)

## Handoff (Teacher → Institution → Super)
- Teacher submits-to-institution → handoff_status=SubmittedToInstitution
- InstitutionBatch adds items → IncludedInInstitutionBatch
- InstitutionBatch submit-to-super → inst_batch_status=SubmittedToSuper
- Super ingests into SuperBatch → IncludedInSuperBatch

## Dedup/conflicts (SuperBatch)
- key: learner_id|cycle_id|subject_id
- auto keep newest locked_at for same level duplicates
- manual resolve for level mismatch or cross-institution collision
