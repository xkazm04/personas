---
id: exec-review-triage
type: tiger/call-site
modality: text
file: src-tauri/src/companion/proactive/execution_review.rs:718
wrapper: cli_text_tracked
provider: claude   model: claude-sonnet-4-6
schema: yes — athena_exec_triage envelope (tolerant parse)
grounding: 3/5
quality_score: 3
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]", "[[solo-founder]]", "[[support-lead]]"]
---
## What it does
Batched headless triage of recently-finished executions flagged by per-persona adaptive baselines: drop / digest / deep_dive. Default = drop.
## Prompt & grounding
`build_triage_prompt` (line 361): flagged groups (slowest/costliest/failures) + per-persona learned p95 bands + exemplar tail (≤600 chars). Cap 24/batch. Grounding 3/5.
## Code quality (wrapping · logging · caching)
cli_text_tracked → ledger (trigger=exec_triage). Two-phase cursor + bounded retry (2). Per-verdict counts in turn outcome. Inflight guard. No cache.
## Findings
- code 4/5: mature baselines + cursor design.
- quality: JSON named but not schema-enforced in prompt (tolerant parser).
- value: keeps the fleet's noise down; restraint lever works.
