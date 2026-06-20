---
id: test-evaluation-llm
type: tiger/call-site
modality: text
file: src-tauri/src/engine/eval.rs:481
wrapper: run_llm_eval (temp driver, LLM_EVAL_MODEL pin) + 2× retry + heuristic fallback
provider: claude   model: claude-sonnet-4-6 (pinned 2026-06-21; was undeclared account-default Opus 4.8)
schema: yes — parse_llm_eval_response (eval.rs:636) + validate (eval.rs:660)
grounding: 7/7
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Scores a test execution 0–100 with rationale + suggestions. Entry: `eval_with_llm` (lab/test scoring).
## Prompt & grounding
"Expert evaluator" system + persona + scenario + expected vs actual (output ≤3000 chars) + criteria. 180s timeout. Grounding 7/7.
## Code quality (wrapping · logging · caching)
2× retry then rule-based `fallback_heuristic` (eval.rs:686). Forgiving JSON extraction. No cost telemetry.
## Findings
- code 3/5: resilient but the heuristic fallback MASKS LLM quality (a timeout shows as "method=Timeout" not error).
- model: Haiku viable if timeout extended.
- value: scales with scenario count in lab runs.
