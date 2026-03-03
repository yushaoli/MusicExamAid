# MusicExamAid Tasks (Sprint 0)

## Setup
- [x] Create clean runtime codebase skeleton
  - `package.json` (npm workspaces: `packages/*`, `services/*`)
  - `tsconfig.json` (composite project references)
- [x] Wire `.env.shared` into runtime config loader
  - `packages/shared/src/env-config.ts` — Zod-validated `loadConfig(envFilePath?)`
- [ ] Add local `make check-shared`
  - `scripts/check-shared.sh` exists; wire into `Makefile` (pending)

## Backend foundation
- [x] Implement `GET /health`
  - `services/api/src/routes/health.ts` — returns `status`, `timestamp`, `version`,
    and stub dependency statuses for `postgres`, `redis`, `s3`
  - Wired in `services/api/src/index.ts` (Fastify, port from `cfg.PORT`)
- [ ] Define DB migration baseline (users/learners/registrations)
- [ ] Add OpenAPI starter from spec subset

## Workflow foundation
- [x] Registration status state-machine constants
  - `packages/shared/src/registration-status.ts`
  - States: `draft | submitted | needs_change | confirmed | locked`
  - Exports: `RegistrationStatus`, `VALID_TRANSITIONS`, `canTransition`, `assertTransition`
  - 17 passing unit tests in `packages/shared/src/__tests__/registration-status.test.ts`
- [ ] Teacher review endpoint stub
- [ ] Export job queue stub

## Data import/organization
- [x] Move imported design packs under `legacy/`
- [x] Keep canonical docs in `docs/`
- [ ] Link old spec -> new implementation decisions

## Quality gates
- [x] Lint + typecheck + test scripts
  - `npm run typecheck --workspaces --if-present`
  - `npm test -w @musicexamaid/shared` → 17 tests, 0 failures
  - `npm run build` → `packages/shared` then `services/api`, zero errors
- [ ] CI workflow checks passing

## Known issues / deferred

- `fastify@4.x` has CVE GHSA-mrq3-vjjr-p77c (DoS via sendWebStream).
  Fix requires v5.7.4+ which needs Node ≥20 (current: 18.19.1).
  Upgrade when Node runtime is updated to 20 LTS.
