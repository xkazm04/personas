---
id: director-coach
type: tiger/call-site
modality: text
file: src-tauri/src/engine/director.rs:597
wrapper: execute_persona_inner (reuses main engine)
provider: claude   model: Director persona's own ModelProfile
schema: yes — parse_verdicts (director.rs:298)
grounding: 8/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]"]
---
## What it does
LLM coach: evaluates a persona's recent executions, emits structured coaching verdicts (severity/category/suggested actions). Entry: `run_director_cycle_for` / `_batch`.
## Prompt & grounding
Locked `DIRECTOR_RUBRIC` (director.rs:66) over 8 categories; `build_director_payload` (director.rs:482) assembles identity + system_prompt (≤1200 chars) + execution history + value rollup + prior Brain coaching (≤4000 chars). Verdicts parsed as `DIRECTOR_VERDICT: {...}` lines. Grounding 8/8.
## Code quality (wrapping · logging · caching)
Indirect via main engine → free telemetry/parsing. Verdicts → `manual_reviews` + `PersonaExecution.director_review`. Brain memory compounds across cycles (director.rs:671). No caching (per-eval).
## Findings
- code 4/5: clean reuse of the apex engine; minor — no explicit own timeout.
- model: coach can run a leaner model than the executor (downgrade candidate).
- value: non-blocking feedback loop; the persona-quality flywheel.
