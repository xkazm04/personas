---
id: project-tracking-consolidator
type: tiger/call-site
modality: text
file: src-tauri/src/engine/project_tracking/consolidator.rs:114
wrapper: base_cli_invocation (one-shot)
provider: claude   model: claude-sonnet-4-6
schema: yes — narrative/directions/tensions update
grounding: 6/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Updates a project "pulse": prior narrative + directions + new signals (commits, runs, notes) → updated narrative/directions/tensions. Publishes pulse-updated event.
## Prompt & grounding
Prior pulse + new signals. 90s timeout. Grounding 6/8.
## Code quality (wrapping · logging · caching)
Episodic append best-effort. No cost telemetry. No cache.
## Findings
- code 3/5: lightweight; no telemetry.
- model: Sonnet; benchmark vs Haiku.
- value: the project momentum narrative.
