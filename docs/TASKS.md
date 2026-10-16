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
- [x] Pass all 27 unit & E2E tests (`npm test`, `npm run typecheck`, `npm run build`)

## Next Up (Live Cutover & Sprint 2)
- [ ] Run `make migrate` on `ubtxiaomi.ts.xgar.com.cn` (`musicexamaid_dev`) and add SQL-backed persistence adapter alongside `DomainRepository`
- [ ] Configure `mea.xgar.com.cn` Caddy vhost (`infra/Caddyfile.xgar.snippet`) and add `WECOM_RELAY_TOKEN` on `derp-sgr`
- [ ] Bind WeChat Service Account + Mini Program (`wxaf3466a310a8bd07`) on WeChat Open Platform and apply `/webhooks/wechat-mp/menu-config`
- [ ] Connect real S3/MinIO presigned portrait photo uploads into `buildExportZipBundle`
