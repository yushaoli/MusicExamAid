# 03 Data Model Notes (ERD v2.2)

## Key concepts
- MusicClass = Institution (one institution has many teachers and many learners)
- TeacherAccount binds to 1..n TeacherProfile(s)
- LearnerProfile belongs to HouseholdAccount
- InstitutionEnrollment links learner to institution (consent-driven)
- RegistrationRecord links learner to institution + cycle + subject + level
- Attachment is polymorphic; 彩照 is an attachment
- InstitutionBatch aggregates locked registrations submitted to institution admin
- SuperBatch aggregates institution batches and exports once

## Snapshot pattern
- snapshot_json is written when teacher locks a registration
- export MUST use snapshot_json only (not live joins)
