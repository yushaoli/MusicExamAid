# MusicExamAid Architecture

## Target structure
- `apps/wechat-mini/` : WeChat Mini Program client (`appid: wx_mini_program_appid`) wired to `https://mea.xgar.com.cn/rpc/:action`
- `services/api/` : Fastify backend API + WeChat Service Account H5 Web Tool (`/app`) + `/rpc/:action` bridge + WeChat MP/WeCom webhooks
- `services/worker/` : async jobs (export generation, file processing)
- `packages/shared/` : shared types, validators, state machine, AES-256-GCM snapshot crypto, Template v2.1 CSV & ZIP bundle builder, WeChat/WeCom helpers
- `infra/` : `.env.shared`, `Caddyfile.xgar.snippet`, and PostgreSQL `migrations/`
- `docs/` : living product/technical docs + `openapi.yaml`
- `legacy/` : imported source design packs and historical docs

## Shared platform & `xgar.com.cn` topology
- **Tailnet mesh (`ts.xgar.com.cn`)**:
  - `ubtxiaomi.ts.xgar.com.cn` (`100.64.0.4`): hosts `devhub-postgres` (`:55432`, DB `musicexamaid_dev`), `devhub-redis` (`:63790`), `devhub-minio` (`:9010`, bucket `musicexamaid-dev`), and the `MusicExamAid` API service (`:3000`).
  - `derp-sgr` (`47.130.165.104` / `100.64.0.1`): hosts the static-IP WeCom relay (`kuma-wecom-relay` at `https://wecom.xgar.com.cn/send/<token>`) and public Caddy ingress.
- **Public API, Web App & Webhook domain**: `https://mea.xgar.com.cn` (configured via `infra/Caddyfile.xgar.snippet`).

## Security, Workflow & Export Pipeline Spec
1. **Encrypted-at-Rest Snapshots (`packages/shared/src/snapshot-crypto.ts`)**:
   - Learner ID numbers are encrypted with **AES-256-GCM** (`gcm:<iv>:<tag>:<ciphertext>`).
   - When a registration is locked (`submitted → locked` or `confirmed → locked`), `snapshot_json` stores `id_number_encrypted` + `id_last4` (never plaintext ID at rest) and resolves `subject_id → 中文专业名称` (`"piano" → "钢琴"`).
   - Plaintext ID is decrypted **only in memory** when generating an export (`mapSnapshotToExportRow` / `formatPortraitPhotoZipPath`).
2. **Portrait Photo + Roster ZIP Bundle (`packages/shared/src/zip-bundle.ts`)**:
   - `GET /exports/:job_id/bundle.zip` packages a standard `.zip` archive containing:
     - `报名汇总表.csv` (Template v2.1 strict header order, UTF-8 BOM, tab-prefixed text IDs/phones)
     - `photos/{证件号码}_{姓名}.jpg` (2-inch portrait photos named per official import spec)
     - `manifest.json` (audit log with SHA-256 checksums)
3. **Zero-Rewrite Mini Program Cutover (`apps/wechat-mini/miniprogram/utils/api.js` + `services/api/src/routes/rpc.ts`)**:
   - All 29 legacy cloud function calls in `miniprogram/utils/api.js` route via `POST https://mea.xgar.com.cn/rpc/:action` without requiring WXML/JS page rewrites.

## API & Web Routes
- `GET /app` (`?tab=parent|archive|console`) — WeChat Service Account & WeCom H5 Web Tool
- `GET /health`
- `GET|POST /learners`, `GET /learners/:id`
- `GET|POST /registrations`, `GET /registrations/:id`, `PATCH /registrations/:id/status`
- `GET|POST /archives`
- `POST /exports`, `GET /exports/:job_id/csv`, `GET /exports/:job_id/bundle.zip`
- `POST /rpc/:action` — Mini Program RPC bridge
- `GET|POST /webhooks/wechat-mp`, `GET /webhooks/wechat-mp/menu-config`
- `GET|POST /webhooks/wecom`
- `POST /notifications/wecom`, `POST /notifications/wechat-mp`
