---
id: memory-review
type: tiger/call-site
modality: text
file: src-tauri/src/commands/core/memories.rs
wrapper: claude_cli_invocation
provider: claude   model: routing
schema: yes — [{id,score,reason}]
grounding: 6/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[support-lead]]"]
---
## What it does
Scores ≤200 memories for relevance (1–10) with optional recent-execution context (≤20 runs, clipped 1KB), classifies delete/update/keep; auto-apply or human-review proposal.
## Prompt & grounding
Memory JSON + optional execution traces + optional operator instructions (≤4096) + scoring rubric. Grounding 6/8.
## Code quality (wrapping · logging · caching)
Two modes (auto_apply default / proposal worker). Deadlock-safe stdin. No cost telemetry. No cache.
## Findings
- code 4/5: tunable threshold + human-in-loop.
- grounding: execution context optional (F-SESSIONS) strengthens staleness detection.
- model: routing; benchmark candidate.
