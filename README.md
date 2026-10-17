# 考级助手 / MusicExamAid (v2.3)

WeChat Service Account (微信服务号) H5 Tool, WeCom (企业微信) Teacher/Admin Console, and WeChat Mini Program (`wx_mini_program_appid`) for music exam registration, review, 1-click snapshot locking, and official Template v2.1 roster + portrait photo ZIP export, hosted on `xgar.com.cn` (`ubtxiaomi.ts.xgar.com.cn`).

## Key Capabilities
1. **WeChat Service Account H5 Web Tool (`GET /app`)**:
   - **我要报名 (`?tab=parent`)**: Create learner profiles (AES-256-GCM encrypted ID at rest, masked `id_last4`) and submit exam registrations.
   - **考级档案 (`?tab=archive`)**: Store and review learner exam results and certificates.
   - **老师/机构工作台 (`?tab=console`)**: 1-click teacher Confirm & Lock (`submitted → locked`), return for modification (`needs_change`), and one-click download of the **Template v2.1 Roster + Portrait Photos ZIP Bundle** (`/exports/:job_id/bundle.zip`) or Excel CSV (`/exports/:job_id/csv`).
2. **Closed-Loop Notifications**:
   - **WeCom Relay (`https://wecom.xgar.com.cn/send/<token>`)**: Real-time markdown alerts to teachers/admins on registration status changes and export jobs.
   - **WeChat Service Account Template Messages (`POST /notifications/wechat-mp`)**: Parent review notifications deep-linking directly to the H5 web tool and Mini Program.
3. **Zero-Rewrite Mini Program Cutover (`apps/wechat-mini`)**:
   - All 29 legacy `miniprogram/utils/api.js` calls route to `POST https://mea.xgar.com.cn/rpc/:action` (`services/api/src/routes/rpc.ts`).

## Repository Structure
- `packages/shared/` — Env config (`loadConfig`), workflow state machine (`RegistrationStatus`), AES-256-GCM snapshot crypto & Template v2.1 mapper (`snapshot-crypto.ts`), ZIP bundle builder (`zip-bundle.ts`), and WeChat/WeCom helpers (`wechat-wecom.ts`).
- `services/api/` — Fastify API server (`health`, `learners`, `registrations`, `archives`, `exports`, `integrations`, `web-app`, `rpc`).
- `apps/wechat-mini/` — WeChat Mini Program client wired to `https://mea.xgar.com.cn/rpc/:action`.
- `infra/` — `.env.shared` (`ubtxiaomi.ts.xgar.com.cn`), `Caddyfile.xgar.snippet`, and PostgreSQL migrations (`migrations/001_initial_schema.sql`).
- `docs/` — [`PRD.md`](docs/PRD.md), [`ARCH.md`](docs/ARCH.md), [`DESIGN_RECONCILIATION.md`](docs/DESIGN_RECONCILIATION.md), [`TASKS.md`](docs/TASKS.md), and [`openapi.yaml`](docs/openapi.yaml).
- `legacy/` — Historical v2.2 / v2.2.1 design packs and CloudBase reference code.

## Quick Commands
```bash
npm run build       # Build @musicexamaid/shared and @musicexamaid/api
npm run typecheck   # Typecheck all workspaces
npm test            # Run all unit and E2E tests (27 tests)
make migrate        # Apply infra/migrations/001_initial_schema.sql to Postgres
```
