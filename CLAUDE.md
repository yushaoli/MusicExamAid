# CLAUDE.md — AI Agent Context for MusicExamAid

> Canonical entry point for Codex, Antigravity (`agy`), Kimi, Claude, and Cursor/Copilot agents working on `MusicExamAid`.

---

## 1. Orchestration & Role Assignment (Reused from `GQJV_Operations`)

Follow [`/Users/flintstone/.agents/COLLABORATION.md`](/Users/flintstone/.agents/COLLABORATION.md) and [`docs/agent-coordination.md`](docs/agent-coordination.md):

- **Default Role Assignment:** **Codex coordinates, Kimi/Antigravity (`agy`) builds.**
  - **Standing PM & Chief Architect:** Primary Codex session owns cross-epic priorities, architecture/readiness review (`PM_GO` / `NEEDS_FIX` / `OWNER_DECISION`), and shared-resource conflict resolution.
  - **Epic Coordinators & Design/Spec Authors:** Run on **Codex** (`gpt-6-sol` / `gpt-6-astra` medium for coordination; `gpt-6.1-sol` / `gpt-6-astra` high for complex architecture).
  - **Coding Workers (`Antigravity` and `Kimi`):**
    - **`Antigravity (agy)`** (`gemini-4-argon-medium` default; `gemini-3.8-flash-medium` / `flash` for fast lookups) lands bounded code, API, and H5/Mini Program UI slices when downstream consumers and acceptance checks are explicit.
    - **`Kimi`** is preferred for ambiguous, analysis-heavy, cross-service, or bulk implementation work.
  - **Delegated Code Review:** Restricted to frontier models (`Claude Opus 5.5` via Cursor/Copilot, OpenAI GPT review models via Codex, Google Gemini review models via Antigravity `agy`), selected by live quota headroom (`orca account list`).
- **One Active Worktree per Epic:** Keep one editing session per worktree. Review diffs read-only without creating extra checkouts.

---

## 2. Project Architecture Map (v2.3)

| Path | Responsibility |
| :--- | :--- |
| `packages/shared/` | `@musicexamaid/shared` — Zod env config (`env-config.ts`), registration status machine with 1-click lock (`registration-status.ts`), AES-256-GCM snapshot encryption & Template v2.1 CSV mapper (`snapshot-crypto.ts`), SuperBatch dedup engine (`dedup.ts`), PKZIP roster+photo bundler (`zip-bundle.ts`), and WeChat MP / WeCom helpers (`wechat-wecom.ts`). |
| `services/api/` | `@musicexamaid/api` — Fastify 5 API, WeChat Service Account H5 Web Tool (`GET /app`), zero-rewrite Mini Program RPC bridge (`POST /rpc/:action`), portrait photo upload (`POST /learners/:id/photo`), SuperBatch dedup preflight (`POST /exports/dedup-preflight`), CSV/ZIP exports, and PostgreSQL migration/pool (`store/postgres.ts`). |
| `apps/wechat-mini/` | WeChat Mini Program (`wx_mini_program_appid`) with `miniprogram/utils/api.js` pointing to `https://mea.xgar.com.cn/rpc/:action`. |
| `infra/` | `migrations/001_initial_schema.sql`, `.env.shared` (`100.64.0.4` / `ubtxiaomi` tailnet IP), and `Caddyfile.xgar.snippet` (`derp-sgr` / `47.130.165.104`). |
| `docs/` | `DESIGN_RECONCILIATION.md`, `PRD.md`, `ARCH.md`, `TASKS.md`, `openapi.yaml`, `agent-coordination.md`. |

---

## 3. Verification Gate (Local)

Run before any milestone handoff or merge:

```bash
npm run build && npm run typecheck && npm test
```

- **Default tests are offline:** `npm test` sets `NODE_ENV=test`, rejects live PostgreSQL/MinIO writes, and skips the shared-storage/ML integration cases. Those cases require an explicit `LIVE_E2E=1` and a suitable test environment.
- **Shared services:** `make migrate` and `GET /health?live=1` connect to `100.64.0.4` (Postgres `:55432`, Redis `:63790`, MinIO `:9010`). Run shared database migrations only as an authorized deployment under the target host lock. `scripts/deploy-xgar.sh --apply <commit>` runs migrations before replacing the service, preserves host secrets/model data, and uses `/tmp/musicexamaid-deploy.lock` with a 60-second bounded wait. Never remove or bypass that lock.
