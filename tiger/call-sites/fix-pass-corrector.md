---
id: fix-pass-corrector
type: tiger/call-site
modality: text
file: src-tauri/src/engine/build_session/fix_pass.rs:55
wrapper: CliProcessDriver (one-shot)
provider: claude   model: routing
schema: yes — corrected_ir validated post-parse
grounding: 7/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
One-shot LLM correction of a broken agent_ir after a build test failure: current_ir + failure_summary → corrected_ir.
## Prompt & grounding
current_ir + failure_summary. Grounding 7/8 (failure context provided; no model routing).
## Code quality (wrapping · logging · caching)
Schema-validated post-parse. No telemetry.
## Findings
- code 4/5: clean correction loop.
- model: routing-default; benchmark candidate.
