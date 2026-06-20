---
id: auto-triage-evaluator
type: tiger/call-site
modality: text
file: src-tauri/src/engine/auto_triage.rs:99
wrapper: run_evaluator_cli (temp driver, build_cli_args(None,None) + EVALUATOR_MODEL pin)
provider: claude   model: claude-sonnet-4-6 (pinned 2026-06-21; was undeclared account-default Opus 4.8)
schema: yes — parse_verdict_response (auto_triage.rs:217), fallback to Resolved
grounding: 6/6
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[support-lead]]"]
---
## What it does
When a capability's review_policy is `auto_triage`, a 2nd LLM pass approves/rejects the `manual_review` against persona decision_principles + constraints — no human. Fire-and-forget. Entry: `spawn_evaluator_task`.
## Prompt & grounding
`build_evaluator_prompt` (auto_triage.rs:99): decision_principles + principles + constraints + review payload + verdict instruction (one-line JSON). 120s timeout. Grounding 6/6.
## Code quality (wrapping · logging · caching)
Clean degrade: CLI fail/parse fail → mark Resolved + `review.auto_triage.fallback` audit tag. No telemetry. No verdict cache.
## Findings
- code 4/5: resilient fallback + strict schema.
- model (COST) — **RESOLVED 2026-06-21 (commit pending).** Was riding the undeclared account default (Opus 4.8), not the persona's tier. Pinned `claude-sonnet-4-6` (EVALUATOR_MODEL) — deliberate, cost-predictable, consistent judge (vs. a cheap persona model rubber-stamping its own output). Persona-align was the alternative; rejected to keep judge quality uniform.
- efficiency: identical payloads re-evaluated (no cache by payload-hash). (open — see Finding #3)
- observability: fallback hides "approved" vs "evaluator crashed". (open)
