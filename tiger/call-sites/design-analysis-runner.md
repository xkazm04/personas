---
id: design-analysis-runner
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/analysis.rs:307
wrapper: spawn_design_run → CliProcessDriver
provider: claude   model: persona ModelProfile (parse_model_profile + build_cli_args(Some(&persona), …) at analysis.rs:117-118)
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
- ~~model (COST): build_cli_args(None,None) ignores ModelProfile~~ → **FALSE POSITIVE (2026-06-21 verify).** All 3 calls in analysis.rs (117-118, 179, 254) already pass `Some(&persona)` + `parse_model_profile`. The discovery agent misread; corrected here.
- grounding: compiler can recommend connectors the user lacks; no availability check. (open)
- code: design_result not schema-validated before persisting (regex extract). (open)
