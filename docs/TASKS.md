# MusicExamAid Tasks (Sprint 0)

## Setup
- [x] Create clean runtime codebase skeleton
  - `package.json` (npm workspaces: `packages/*`, `services/*`)
  - `tsconfig.json` (composite project references)
- [x] Wire `.env.shared` into runtime config loader
  - `packages/shared/src/env-config.ts` — Zod-validated `loadConfig(envFilePath?)`
- [x] Add local `make check-shared`
  - `scripts/check-shared.sh` wired into root `Makefile`

## Backend foundation
- [x] Implement `GET /health`
  - `services/api/src/routes/health.ts` — returns `status`, `timestamp`, `version`,
    and stub dependency statuses for `postgres`, `redis`, `s3`
  - Wired in `services/api/src/app.ts` and `services/api/src/index.ts` (Fastify, port from `cfg.PORT`)
- [x] Define DB migration baseline (users/learners/registrations)
  - `infra/migrations/001_initial_schema.sql`
- [x] Add OpenAPI starter from spec subset
  - `docs/openapi.yaml`

## Workflow foundation
- [x] Registration status state-machine constants
  - `packages/shared/src/registration-status.ts`
  - States: `draft | submitted | needs_change | confirmed | locked`
  - Exports: `RegistrationStatus`, `VALID_TRANSITIONS`, `canTransition`, `assertTransition`
  - 17 passing unit tests in `packages/shared/src/__tests__/registration-status.test.ts`
- [x] Teacher review endpoint stub
  - `PATCH /registrations/:id/status` in `services/api/src/routes/registrations.ts`
- [x] Export job queue stub
  - `POST /exports` in `services/api/src/routes/exports.ts`

## Data import/organization
- [x] Move imported design packs under `legacy/` and remove root duplicates
- [x] Keep canonical docs in `docs/`
- [x] Link old spec -> new implementation decisions (`docs/ARCH.md`)

## Quality gates
- [x] Lint + typecheck + test scripts
  - `npm run typecheck --workspaces --if-present`
  - `npm test` → 22 tests (17 shared + 5 api), 0 failures
  - `npm run build` → `packages/shared` then `services/api`, zero errors
- [ ] CI workflow checks passing

## Next Up (Sprint 1)
- [ ] Connect `pg` pool, Redis client, and S3 client in `services/api` and wire live `/health` probes
- [ ] Port AES-256 ID encryption & snapshot builder (`buildSnapshot`, `computeMissingFlags`) into `@musicexamaid/shared`
- [ ] Persist `learners`, `registrations`, and `registration_status_history` to PostgreSQL
- [ ] Implement worker consumer for `export_batches` using Template v2.1 header mapping (`export_mapping_spec.json`)
