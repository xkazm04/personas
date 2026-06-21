---
id: goal-decompose-steps
type: tiger/call-site
modality: text
file: src-tauri/src/engine/team_assignment_matching.rs:462
wrapper: CliProcessDriver::spawn_temp_no_stderr (build_cli_args(None,None))
provider: claude   model: routing (no explicit --model)
schema: yes — strict {steps:[...]} parse (line 502); hallucinated persona ids dropped
grounding: 7/8
quality_score: 3
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[hobbyist-power]]", "[[software-developer]]"]
---
## What it does
Decomposes a goal into 2–5 chained executable steps for a team's eligible personas — only when the goal has no authored to-dos (else steps taken verbatim). Linear SDLC chain (scope→implement→review→security→docs).
## Prompt & grounding
`build_decompose_prompt` (line 402): goal title/desc + roster candidates + capability→step hints. No repo access (temp cwd). Grounding 7/8.
## Code quality (wrapping · logging · caching)
Engineer-pinning guard (goal_advance.rs:134) prevents funnel loss to architect. Persona-id validation drops hallucinations. No telemetry. ~120s timeout. No retry.
## Findings
- code 4/5: strong validation; silent (no logging on success).
- value: the goal→team execution bridge.
- model: routing-default; benchmark candidate.
