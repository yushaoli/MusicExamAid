# AGENTS.md

This file exists so that CLI tools which look for `AGENTS.md` (Codex, Antigravity `agy`, Kimi, OpenCode, and similar) load the same project context and orchestration rules as Claude Code.

**Canonical project context lives in [`CLAUDE.md`](CLAUDE.md). Read that first.** Do not duplicate it here.

Then, in this order:

1. [`/Users/flintstone/.agents/COLLABORATION.md`](/Users/flintstone/.agents/COLLABORATION.md) — owner collaboration protocol, worktree rules, delegated code review, and task-based role/model balancing.
2. [`docs/agent-coordination.md`](docs/agent-coordination.md) — Orca topology (`Codex coordinates, Kimi/Antigravity builds`), model selection, and local gate conventions reused from `GQJV_Operations`.
3. [`docs/DESIGN_RECONCILIATION.md`](docs/DESIGN_RECONCILIATION.md) — authoritative v2.3 architecture & design decisions.
4. [`docs/TASKS.md`](docs/TASKS.md) — active milestone checklist and external cutover items.
