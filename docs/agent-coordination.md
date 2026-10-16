# Agent Coordination & Task-Based Model Balancing

> Reused from `GQJV_Operations/docs/agent-coordination.md` and `/Users/flintstone/.agents/COLLABORATION.md`.

## 1. Orca Topology: Coordinators, Slices, and Picking the Agent

- **One active worktree per epic by default.** A small or medium feature is implemented in the epic worktree (by the coordinator or one retained author). Create a temporary child worktree only when independent parallel development has a clear delivery benefit.
- **One editor per worktree.** Never run two editing sessions in the same directory. `pwd` before every `git commit`, `git checkout`, or `git reset`. Reviewers inspect diffs read-only without switching branches or mutating the tree.
- **Standing PM & Architect:** The primary Codex session owns cross-epic architecture alignment, milestone readiness review (`PM_GO`, `NEEDS_FIX`, `OWNER_DECISION`), and shared-resource conflict resolution. The human owner gives final deployment GO/NO-GO.

## 2. Default Role Assignment (`Codex coordinates, Kimi/Antigravity builds`)

- **Epic coordinators & design/spec authors:** Run on **Codex** (`gpt-6-sol` or `gpt-6-astra` medium for coordination; `gpt-6.1-sol` or `gpt-6-astra` high for complex architecture).
- **Coding slices (`Antigravity` and `Kimi`):** Both are first-class workers:
  - **`Antigravity (agy)`** (`gemini-4-argon-medium` default; `gemini-3.8-flash-medium` / subagent `flash` for fast lookups) lands bounded code, API, and UI changes well when downstream consumers and the acceptance check are named in the brief.
  - **`Kimi`** is the better pick for ambiguous, analysis-heavy, cross-service, or bulk implementation work.
  - Deviating from the default needs a brief reason noted in the dispatch comment.
- **Delegated independent code review:** Restricted to current frontier models from OpenAI, Anthropic, or Google:
  - `Claude Opus 5.5` (`claude-opus-5-5-high`) via Cursor or GitHub Copilot (`--agent cursor` | `copilot`)
  - OpenAI GPT review models (`gpt-6.1-sol` / `gpt-6-astra` `--effort high`) via Codex (`--agent codex`)
  - Google Gemini review models (`gemini-4-argon-high` / subagent `pro`) via Antigravity (`--agent antigravity`)

## 3. Picking the Agent & Model Within a Role

Weigh, in order:

1. **Fitness for the task:** Match the task shape (bounded code/UI slice with clear acceptance → `agy`; ambiguous/cross-service analysis or bulk slice → `kimi`; coordination/spec → `codex`; independent code review → frontier review pool; deterministic mechanical work → shell scripts, `Makefile`, `codegraph`).
2. **Available quota:** Check live quota before dispatching (`orca account list` for managed Claude/Codex/Cursor/Copilot/Antigravity pools; Kimi quota in its app). A worker that can start immediately beats a slightly better-fit route queued behind quota exhaustion.
3. **Cost and latency:** Reserve heavyweight frontier/high-effort models for ambiguous architecture, security/migration risk, and independent code review; use balanced or lighter models for mechanical slices with a tight acceptance check (`npm test && npm run typecheck`). Always verify `launch.effective` against `launch.requested`.
