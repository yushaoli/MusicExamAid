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
| `apps/wechat-mini/` | WeChat Mini Program (`wxaf3466a310a8bd07`) with `miniprogram/utils/api.js` pointing to `https://mea.xgar.com.cn/rpc/:action`. |
| `infra/` | `migrations/001_initial_schema.sql`, `.env.shared` (`100.64.0.4` / `ubtxiaomi` tailnet IP), and `Caddyfile.xgar.snippet` (`derp-sgr` / `47.130.165.104`). |
| `docs/` | `DESIGN_RECONCILIATION.md`, `PRD.md`, `ARCH.md`, `TASKS.md`, `openapi.yaml`, `agent-coordination.md`. |

---

## 3. Verification Gate (Local)

Run before any milestone handoff or merge:

```bash
make migrate && npm run build && npm run typecheck && npm test
```

- **Note on Local ≠ Offline:** `make migrate` and `GET /health?live=1` connect to the shared `devhub-postgres` (`100.64.0.4:55432/musicexamaid_dev`), `devhub-redis` (`:63790`), and `devhub-minio` (`:9010`) on `ubtxiaomi`. Focused unit/E2E tests (`npm test`, `npm run typecheck`, `npm run build`) run in-process without mutating shared database rows.
