---
id: design-analysis-runner
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/analysis.rs:307
wrapper: spawn_design_run → CliProcessDriver (build_cli_args(None,None))
provider: claude   model: claude-sonnet-4 (hardcoded; ignores persona ModelProfile)
schema: weak — extract_design_result (regex, no schema validate)
grounding: 5/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Persona design refinement: user instruction ("add support for X") → compiles persona, runs Claude, returns refined design_result JSON → persona.last_design_result. Entry: `start_design_analysis`.
## Prompt & grounding
`assemble_prompt` (engine/compiler.rs): persona AgentIr + tools + connectors + instruction + design_context + prior result. Grounding 5/8.
## Code quality (wrapping · logging · caching)
Good run-registry (cancels overlapping run on same persona). Weak: regex JSON extraction, no schema validate before DB write. No self-repair.
## Findings
- model (COST): `build_cli_args(None,None)` at analysis.rs:118 ignores persona ModelProfile (contrast build_sessions.rs:129 which passes `Some(&persona)`) — silent 10× cost.
- grounding: compiler can recommend connectors the user lacks; no availability check.
- code: design_result not schema-validated before persisting.
