---
id: task-executor
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/task_executor.rs:656
wrapper: direct Command spawn (+ optional --worktree)
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 668)
schema: no — free-form + [Progress] JSON markers
grounding: 6/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Executes multi-stage dev tasks (campaign/deep_build/quick). Streams output, parses [Progress] milestones → progress_pct, auto-opens a PR when run in an isolated worktree.
## Prompt & grounding
`build_task_prompt` (line 140): title + desc + linked idea/goal context + codebase contexts + depth strategy. Grounding 6/8 (weaker when idea/goal absent).
## Code quality (wrapping · logging · caching)
Worktree isolation (parallel-safe). [Progress] milestone mapping; volume fallback. Auto-PR best-effort (failure ≠ task fail). Capped stderr ring. No cost telemetry.
## Findings
- code 4/5: worktree + auto-PR are strong; no cost telemetry.
- model: hardcoded Sonnet; complex tasks may warrant Opus upgrade.
- value: the autonomous "do the work" executor.
