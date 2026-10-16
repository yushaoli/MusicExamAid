# MusicExamAid Architecture (initial)

## Target structure
- `apps/wechat-mini/` : mini-program client shell (`appid: wxaf3466a310a8bd07`)
- `services/api/` : backend API (auth, profiles, registration, archive, export, WeChat MP & WeCom webhooks)
- `services/worker/` : async jobs (export generation, file processing)
- `packages/shared/` : shared types, validators, state machine, WeChat/WeCom helpers
- `infra/` : `.env.shared`, `Caddyfile.xgar.snippet`, and PostgreSQL `migrations/`
- `docs/` : living product/technical docs + `openapi.yaml`
- `legacy/` : imported source design packs and historical docs

## Shared platform & `xgar.com.cn` topology
- **Tailnet mesh (`ts.xgar.com.cn`)**:
  - `ubtxiaomi.ts.xgar.com.cn` (`100.64.0.4`): hosts `devhub-postgres` (`:55432`, DB `musicexamaid_dev`), `devhub-redis` (`:63790`), `devhub-minio` (`:9010`, bucket `musicexamaid-dev`), and the `MusicExamAid` API service (`:3000`).
  - `derp-sgr` (`47.130.165.104` / `100.64.0.1`): hosts the static-IP WeCom relay (`kuma-wecom-relay` at `https://wecom.xgar.com.cn/send/<token>`) and public Caddy ingress.
- **Public API & Webhook domain**: `https://mea.xgar.com.cn` (configured via `infra/Caddyfile.xgar.snippet`).
  - Required for WeChat Mini Program `wx.request` domain allowlisting and WeChat Service Account / WeCom server callbacks.

## WeChat Service Account (服务号) & WeCom (企业微信) Integration
1. **Identity Linking (`users` table)**:
   - `openid`: WeChat Mini Program user ID.
   - `unionid`: Cross-app identifier linking the parent's Mini Program account and the WeChat Service Account under the same WeChat Open Platform account.
   - `mp_openid` + `mp_subscribed`: WeChat Service Account follower state for pushing parent review notifications.
   - `wecom_userid`: Teacher / Admin / Super operator corporate identity (`WECOM_CORPID=wwdf0a37a3059d0f1c`).
2. **Parent Channel — WeChat Service Account (`GET|POST /webhooks/wechat-mp`, `POST /notifications/wechat-mp`)**:
   - Sends Official/Service Account Template Messages when a registration transitions to `needs_change`, `confirmed`, or `locked`.
   - Deep-links directly back into the Mini Program (`miniprogram.appid = wxaf3466a310a8bd07`, `pages/registration/detail/detail?id=<reg_id>`).
3. **Teacher / Admin / Ops Channel — WeCom (`GET|POST /webhooks/wecom`, `POST /notifications/wecom`)**:
   - Reuses the live `xgar` WeCom relay (`POST https://wecom.xgar.com.cn/send/<WECOM_RELAY_TOKEN>`, corp `wwdf0a37a3059d0f1c`) so outbound notifications egress from the trusted static IP (`47.130.165.104`).
   - Pushes real-time markdown cards to teachers/admins when registrations change status (`PATCH /registrations/:id/status`) or when Excel export batches are queued (`POST /exports`).

## Core domain modules
1. Identity & roles (Mini Program + Service Account `unionid` + WeCom)
2. Learner profile
3. Registration workflow
4. Archive & attachments
5. Export pipeline
6. WeChat MP & WeCom notifications

## API baseline
- `GET /health`
- `POST /learners`
- `GET /learners/:id`
- `POST /registrations`
- `PATCH /registrations/:id/status`
- `POST /archives`
- `POST /exports`
- `GET|POST /webhooks/wechat-mp`
- `GET|POST /webhooks/wecom`
- `POST /notifications/wecom`
- `POST /notifications/wechat-mp`
