# MusicExamAid Architecture (initial)

## Target structure
- `apps/wechat-mini/` : mini-program client shell
- `services/api/` : backend API (auth, profiles, registration, archive, export)
- `services/worker/` : async jobs (export generation, file processing)
- `packages/shared/` : shared types, validators, constants
- `docs/` : living product/technical docs
- `legacy/` : imported source design packs and historical docs

## Shared platform dependencies
- Postgres: `musicexamaid_dev`
- Redis: `63790`
- MinIO bucket: `musicexamaid-dev`

## Core domain modules
1. Identity & roles
2. Learner profile
3. Registration workflow
4. Archive & attachments
5. Export pipeline

## Data model (initial entities)
- User
- LearnerProfile
- RegistrationRecord
- RegistrationStatusHistory
- ExamRecord
- Attachment
- ExportBatch

## API baseline (first pass)
- `GET /health`
- `POST /learners`
- `GET /learners/:id`
- `POST /registrations`
- `PATCH /registrations/:id/status`
- `POST /archives`
- `POST /exports`
