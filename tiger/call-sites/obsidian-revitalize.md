---
id: obsidian-revitalize
type: tiger/call-site
modality: text
file: src-tauri/src/commands/obsidian_brain/revitalize.rs:1
wrapper: cli_text (tokio Command + BackgroundJobManager)
provider: claude   model: routing (build_cli_args, opaque here)
schema: no — output consumed as-is
grounding: 2/5
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Background "sleep cycle" for a vault: consolidate/prune/merge/refresh notes (≤40/pass). Opt-in background job.
## Prompt & grounding
`build_revitalize_prompt` (line 124): prune/merge/refresh goals + memo context + note list. Grounding 2/5.
## Code quality (wrapping · logging · caching)
Streaming progress. 540s soft timeout. No token accounting. No cache.
## Findings
- code 3/5: opaque model; no telemetry; no structured extraction.
- model: not pinned at call site.
- grounding: not parameterized for safety-first vs aggressive pruning.
