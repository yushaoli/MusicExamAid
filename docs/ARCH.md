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
- `POST /parent/auth`, `GET /parent/session`
- `PUT|DELETE /parent/learners/:learnerId/grant`, `GET /parent/learners/:learnerId/grants`
- `GET|POST /webhooks/wechat-mp`, `GET /webhooks/wechat-mp/menu-config`
- `GET|POST /webhooks/wecom`
- `POST /notifications/wecom`, `POST /notifications/wechat-mp`

## Export authorization

All `/exports` routes (`POST /exports`, `POST /exports/dedup-preflight`, CSV and ZIP downloads) require a verified family-admin session, including when `ENFORCE_SERVER_AUTH=0` in development. `POST /rpc/superBatchExportOnce` enforces the same boundary so the Mini Program bridge cannot bypass it. Header, bearer and family cookie credentials are supported; teacher sessions do not authorize exports. Responses use `Cache-Control: no-store` because previews and downloads contain plaintext identity numbers and portrait photos.

Export batches do not yet have verified teacher ownership metadata. Teacher access therefore fails closed rather than trusting a client-supplied teacher or institution ID. Parent-learner grants do not authorize exports; scoped parent and teacher export access remains follow-up work.

## Financial authorization

All payment and concession routes require a verified family-admin session in every environment: rate-card reads/writes, checkout, wallet reads, concession confirmation, withdrawal requests, and payout approval. The equivalent RPC actions (`teacherRateCardsGet`, `adminUpsertTeacherRateCard`, `paymentCheckout`, `teacherConcessionWallet`, `adminConfirmConcession`, `teacherRequestWithdrawal`, and `adminPayoutWithdrawal`) enforce the same boundary. Anonymous and teacher credentials are rejected before financial repository access, and guarded responses use `Cache-Control: no-store`.

The current teacher session identifies a numeric official-portal agent, while financial records use string teacher IDs. No verified agent-to-financial-teacher mapping or parent-to-registration ownership exists yet. Parent-learner grants alone do not authorize checkout. Financial operations therefore remain admin-only instead of trusting a request's `teacher_id` or `registration_id`.

## Learner, registration and archive authorization

All learner, registration and archive routes require a verified family-admin session in every environment, including portrait upload and registration status changes. Their 14 learner/enrollment/registration/teacher-workflow RPC actions enforce the same boundary. `POST /official-sync/consolidate` and both upgrade-radar routes also require admin credentials because they read or create the same domain records. Learner-linked ID-photo polish requires admin credentials; generic photo processing without `learner_id` remains public because it does not open the repository.

Anonymous and teacher credentials are rejected before repository access, and guarded responses use `Cache-Control: no-store`. Parent and teacher domain workflows stay disabled until record-level grant checks are added to those routes. The current parent session exposes only explicitly granted learner IDs. A client-supplied learner, registration, teacher or institution ID is never proof of ownership.

## Integration and notification authorization

Outbound WeCom and Service Account notification routes require a verified family-admin session before validation or dispatch and return `Cache-Control: no-store`. Anonymous and teacher credentials cannot trigger external messages. Signed inbound webhook callbacks remain public, but both WeChat MP and WeCom POST receivers now reject missing or invalid signatures instead of accepting unsigned events.

## Official-sync authorization

All official-sync administration routes are strict family-admin-only by default, including archive statistics and upgrade reports, partner agents, studio intelligence, teacher fee/filing reports, upload logs, score lookup/captcha, model status, and remote pulls. The policy applies before SQL, object-storage, media-processing or official-portal work in every environment and returns `Cache-Control: no-store`.

Only seven entry points are exempt from the plugin-wide admin hook because they authenticate in their own handlers: session status, QR session creation/polling, family-token verification, teacher-scoped student lookup, invite/session resolution, and invite-based teacher WeChat binding. ID-based session resolution and teacher binding require strict admin credentials. Student lookup retains its narrower teacher scope; the exemptions do not make administrative data public.

## Media and remaining RPC authorization

The media proxy, cache statistics, prebuffer, certificate/photo staging and execution, video initial-review check/apply, and AI 5D review routes require a verified family-admin session before SQL, object-storage, media-processing or portal work. This strict policy also applies in development and returns `Cache-Control: no-store`.

The Mini Program RPC bridge is now default-deny. Only `getDictSubjects`, `getDictCycles` and the static `institutionList` remain public; every other current or future action requires a verified family-admin session. The 18 declared but unimplemented legacy actions return `501 RPC_NOT_IMPLEMENTED`, including the former `authLogin` placeholder that invented admin roles. Unknown actions return `404 RPC_NOT_FOUND`; neither case reports false success. The Mini Program now sends its verified parent token on direct RPC requests, but parent credentials do not satisfy the admin guard. Protected workflows remain unavailable until their record-level ownership checks are implemented.

## Parent identity and ownership grants

`POST /parent/auth` accepts a one-time `wx.login` code and exchanges it server-side with WeChat `code2Session` using `WECHAT_MINI_APPID` and `WECHAT_MINI_SECRET`. The server derives parent identity only from the provider response. It never accepts an OpenID from the parent client, and never returns or persists the WeChat `session_key`. Successful login issues a two-hour role-specific HMAC session through `X-Mea-Parent-Session`, bearer credentials, or the `mea_parent_session` HttpOnly, SameSite=Lax cookie (`Secure` in production). Responses use `Cache-Control: no-store`.

Authentication does not imply ownership. `infra/migrations/010_parent_learner_grants.sql` defines standalone, revocable grants keyed by provider-verified parent OpenID and the running repository's string learner ID. Strict family admins create, list and revoke these grants through `/parent/learners/:learnerId/grant(s)`. Grant creation requires an existing learner. `GET /parent/session` returns only the authenticated parent's active granted learner IDs; revoking a grant removes access on the next request even while the parent token remains valid. Grant audit rows retain the revocation timestamp.

The legacy `learners.parent_user_id`, `mp_default_parent_openid`, referrals, teacher IDs, registration IDs and institution IDs are not ownership evidence. The Mini Program uses `wx.login`, stores only the parent token, and refreshes expired sessions. Parent historical lookup, learner profiles, registration workflows, exports and checkout remain disabled until each operation enforces these grants at record level. No live migration or provider exchange is part of offline tests.

## Historical student lookup authorization

`GET /official-sync/student-lookup` always requires a verified session, including in development when `ENFORCE_SERVER_AUTH=0`. Family-admin sessions retain full historical access. A client-supplied role, agent ID, OpenID or referral code does not grant access.

`GET /official-sync/resolve-session?invite_token=...` exchanges a current teacher invite matching `t_inv_<agent_id>_<32 hex characters>` for an eight-hour HMAC-signed teacher session. The browser receives the session in the `mea_teacher_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production); the token is not returned in JSON. Lookup also accepts `X-Mea-Teacher-Session` or a teacher bearer token. Teacher credentials never authorize family-admin routes. Public demo and legacy invites can still resolve their landing page, with `history_access: false`, but cannot create a lookup session.

Each teacher lookup rechecks the current invite digest in Postgres, so rotating or removing the invite revokes existing sessions immediately. The server derives the agent ID from the signed token. An explicit different `agent_id` is rejected with 403. Teachers can see only student profiles currently assigned to their agent ID and exam rows recorded under that agent ID. Counts, latest exams and upgrade recommendations use that same restricted history; exams from other institutions are excluded. Admins may filter profiles by current agent while retaining access to complete exam history.

Session resolution and lookup return `Cache-Control: no-store`. Invalid invites and parent referral resolution clear the teacher cookie. Parent referrals identify an entry channel; they do not prove ownership of any learner. Parent lookup remains unavailable until historical records are scoped through the new verified parent-to-learner grants. Verified teacher financial and export mappings remain separate follow-up work.
