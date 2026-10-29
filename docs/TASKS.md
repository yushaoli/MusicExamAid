# MusicExamAid Tasks

## Completed (Sprint 0 & Design Reconciliation v2.3)
- [x] Create clean runtime codebase skeleton (`packages/shared`, `services/api`, `apps/wechat-mini`)
- [x] Wire `infra/.env.shared` (`ubtxiaomi.ts.xgar.com.cn`) into Zod-validated `loadConfig(envFilePath?)`
- [x] Add root `Makefile` (`build`, `test`, `typecheck`, `check-shared`, `migrate`) and `scripts/migrate.sh`
- [x] Remove duplicate root legacy files and keep canonical reference packs under `legacy/`
- [x] Define PostgreSQL schema baseline in `infra/migrations/001_initial_schema.sql` (including `users` fields for `unionid`, `mp_openid`, `wecom_userid`, and `notification_logs`)
- [x] Implement `GET /health` with both fast stub mode and live TCP connectivity probes (`GET /health?live=1`) against `ubtxiaomi.ts.xgar.com.cn` (`:55432`, `:63790`, `:9010`)
- [x] Optimize registration status state machine (`packages/shared/src/registration-status.ts`) with **1-click `submitted → locked`** and `locked → needs_change`
- [x] Upgrade ID encryption to **AES-256-GCM** (`packages/shared/src/snapshot-crypto.ts`), keep `id_number_encrypted` encrypted at rest inside `snapshot_json` (decrypting only in memory at export), and resolve `subject_id → 中文专业名称` (`"piano" → "钢琴"`)
- [x] Build Template v2.1 CSV serializer (`GET /exports/:job_id/csv`) and **Roster + Portrait Photo ZIP bundle builder** (`GET /exports/:job_id/bundle.zip` in `packages/shared/src/zip-bundle.ts`)
- [x] Add **WeChat Service Account & WeCom H5 Web Tool** (`GET /app` in `services/api/src/routes/web-app.ts`), custom menu config generator (`GET /webhooks/wechat-mp/menu-config`), Service Account/WeCom webhooks, and `wecom.xgar.com.cn` alert dispatcher
- [x] Add zero-rewrite Mini Program RPC bridge (`POST /rpc/:action` in `services/api/src/routes/rpc.ts`) and migrate `apps/wechat-mini/miniprogram/utils/api.js` from `wx.cloud` to `https://mea.xgar.com.cn/rpc/:action`
- [x] Document full design reconciliation in `docs/DESIGN_RECONCILIATION.md`, `docs/ARCH.md`, `docs/PRD.md`, and `docs/openapi.yaml`
- [x] Add SuperBatch deduplication & conflict resolution engine (`packages/shared/src/dedup.ts` and `POST /exports/dedup-preflight`)
- [x] Add portrait photo upload (`POST /learners/:id/photo`) and wire uploaded photo bytes into `GET /exports/:job_id/bundle.zip`
- [x] Add PostgreSQL pool, migration runner (`services/api/src/store/postgres.ts`), and live write-through persistence (`services/api/src/store/sql-sync.ts`) on `ubtxiaomi` (`100.64.0.4:55432/musicexamaid_dev`)
- [x] Add zero-dependency S3/MinIO SigV4 storage client (`services/api/src/store/minio.ts`) and wire portrait photo + ZIP bundle uploads to `100.64.0.4:9010/musicexamaid-dev`
- [x] Add production `Dockerfile`, `infra/docker-compose.prod.yml`, and WeChat Service Account menu publisher (`scripts/apply-wechat-menu.sh`)
- [x] Reuse `GQJV_Operations` agent orchestration & task-based model balancing in `CLAUDE.md`, `AGENTS.md`, `docs/agent-coordination.md`, and `/Users/flintstone/.agents/COLLABORATION.md`
- [x] Pass all 29 unit & live E2E tests (`make migrate`, `npm test`, `npm run typecheck`, `npm run build`)
- [x] Enforce **100% Mainland China PIPL data boundary** (removed Singapore `derp-sgr` proxy; pointed `mea.xgar.com.cn` to `100.64.0.4` with local Cloudflare DNS-01 TLS on `ubtxiaomi`; added `redactPii()` to strip all PII from WeCom alerts; added Tencent Mainland `wx.cloud` fallback in `apps/wechat-mini/miniprogram/utils/api.js`)

## Next Up (Optional External Console Cutover)
- [ ] Add `WECOM_RELAY_TOKEN` to `/opt/stacks/musicexamaid/infra/.env.shared` on `ubtxiaomi` if anonymous WeCom push notifications are desired
- [ ] Open `apps/wechat-mini` in WeChat DevTools to publish the dual-mode Mainland Mini Program (`wx_mini_program_appid`)

## Security / ML / Reliability follow-ups (2026-10-20 handover)

- [x] Review PR #2 and fix invite-token/agent-ID authorization bypass, token disclosure endpoints, production signing fallback, legacy nonexpiring sessions, dynamic inline handlers, and invited-teacher binding.
- [x] Make default API tests offline; add isolated auth/XSS/storage-boundary and migration rollback coverage.
- [x] Commit schema changes and migration ledger entries atomically; serialize migration runners with an advisory lock. Migration 009 replaces 008's tokens with 16 cryptographically random bytes without replaying old seeds.
- [x] Prepare exact-commit mainland deployment with host lock, retained secrets/model data, SHA-tagged images, and image rollback on failed health/auth checks.
- [x] Add offline ML audit, incremental feature extraction, learner/duplicate-video-disjoint ordinal trials, model inference and teacher-label tooling; complete an initial trial on downloaded audio. See [trial evidence](ML_TOOLING_TRIAL.md) and [commands](../scripts/ml_lab/README.md).
- [x] Prepare a blinded 200-clip teacher packet with 100 calibration and 100 held-out test clips, reserving their learners from all training. Labels remain unfilled.
- [x] Add a private teacher review page for the existing packet: authenticated loopback playback/seeking, explicit recording-quality judgments, atomic save/resume and compatible CSV export. Preserve the original reservation and keep five-dimensional ratings unfilled until the rubric is confirmed.
- [x] Finish the live-season mirror and verify its files: 24,327 videos, 24,326 audio files meeting the size check, 974 unavailable URLs. Add labeled-only extraction; start the bounded full-cohort continuation on 2026-10-27. See [continuation evidence and status path](ML_TOOLING_TRIAL.md#completed-mirror-and-larger-trial--2026-10-27).
- [x] Complete and review the full-cohort trial: 4,630 extractions succeeded; no labeled feature gaps remain. Independently verify holdout exclusion, folds, all 25 full-model and 50 simple-baseline confusion matrices. Full model wins 17/25 comparisons; zero-score recall is 0/69 exam/dimension ratings. See [reviewed evidence](ML_TOOLING_TRIAL.md#full-cohort-results).
- [x] Add and run retrospective forward-season validation on 20265, purge all test-season learner/video groups from historical training, and independently recompute all 100 variant confusion matrices/metrics. Full model wins 7/20 comparisons; latest-season label distributions shift strongly. See [forward-season evidence](ML_TOOLING_TRIAL.md#forward-season-check--2026-10-28).
- [ ] Complete role-scoped server auth for student lookup, exports, learners, registrations, archives, financial routes, media and RPC. Derive teacher/parent ownership from verified sessions; reject cross-owner access regardless of client-supplied IDs.
- [ ] Train the four ordered 5D classes (好/较好/一般/尚可) per instrument family; report grouped validation, baselines and acoustic-only ablation. Default/prior scores must not be presented as measured performance.
- [x] Record the owner's 2026-10-29 decision: defer the 200 manual reviews because teacher capacity is unavailable; use incoming official examiner results for 5D calibration and a separate final test. See the [prospective plan](ML_TOOLING_TRIAL.md#calibration-plan--2026-10-29-owner-decision). Historical-label development can continue independently.
- [x] Implement offline candidate freezing, score-blind intake from a fixed snapshot, separate official-score temperature calibration and one final evaluation. Preserve learner/video groups and the teacher reservation; reject later identity merges across partitions, expose coverage/rare-class gaps, and mark historical rehearsals explicitly. See [commands and limits](../scripts/ml_lab/README.md#official-score-calibration).
- [x] Exercise the official-score workflow on the existing archive as a retrospective rehearsal: 79 reserved groups, three supported keyboard calibration dimensions, 17 unsupported cases. Independently verify 53 variant confusion matrices and probability metrics; all 37 ML/reviewer tests pass. Confidence loss improves on 19 keyboard test exams; class predictions are unchanged. See [rehearsal evidence](ML_TOOLING_TRIAL.md#official-score-workflow-rehearsal--2026-10-29).
- [ ] Before inspecting incoming scores, freeze the candidate model, preprocessing, historical data cutoff and evaluation protocol; reserve unseen learner/video groups separately for calibration and final testing. The already-analyzed 20265 archive is retrospective evidence. Enroll the new cohort only when its media and official five-dimensional results become available; preserve the original 200-group reservation.
- [ ] Calibrate 5D predictions using only the new calibration groups; evaluate once on the untouched test groups, reporting per-family/dimension class support, baselines and errors. Confirm the named-rating mapping and zero semantics before claiming named four-class recognition; report rare-class/voice gaps rather than filling them with defaults.
- [ ] Deferred: obtain independent recording-quality judgments and measure 初审 false rejection / false acceptance before enabling automatic portal decisions. Official performance scores cannot substitute for these judgments; the 200-clip packet remains available for later use, with no review campaign scheduled.
- [ ] Confirm the authorized basis for training on minors' videos and validate the claimed report behavior before commercial use.
- [ ] Make Postgres authoritative for registrations, payment orders, concessions and withdrawals, including startup reload, transactions, idempotency and restart tests.
- [ ] Move heavy media work to background jobs, split `official-sync.ts` / `web-app.ts`, and reconcile `PRD.md`, `ARCH.md`, and `openapi.yaml` with implemented routes.
- [ ] Rotate previously tracked Postgres / MinIO credentials and address repository history exposure in a separate authorized infrastructure change.
- [ ] Resolve dependency advisories identified in the 2026-10-20 build/audit before public launch.
