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
- [x] Add PostgreSQL pool & migration runner (`services/api/src/store/postgres.ts`) and apply `001_initial_schema.sql` to live `musicexamaid_dev` on `ubtxiaomi` (`100.64.0.4:55432`)
- [x] Pass all 28 unit & E2E tests (`make migrate`, `npm test`, `npm run typecheck`, `npm run build`)

## Next Up (External Console Cutover)
- [ ] Configure `mea.xgar.com.cn` Caddy vhost (`infra/Caddyfile.xgar.snippet`) and add `WECOM_RELAY_TOKEN` on `derp-sgr` (`47.130.165.104`)
- [ ] Bind WeChat Service Account + Mini Program (`wxaf3466a310a8bd07`) on WeChat Open Platform and apply `/webhooks/wechat-mp/menu-config`
- [ ] Switch portrait photo buffer persistence to S3/MinIO (`100.64.0.4:9010/musicexamaid-assets`) for multi-replica production
