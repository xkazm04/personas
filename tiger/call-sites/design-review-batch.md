---
id: design-review-batch
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/reviews.rs:272
wrapper: run_cli_for_template (per template, build_cli_args(None,None))
provider: claude   model: claude-sonnet-4 (hardcoded)
schema: yes — design_result + feasibility (post-hoc)
grounding: 7/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Batch test-case persona generation: for each selected test case build an enriched instruction → Claude → design_result → feasibility score → PersonaDesignReview row. Entry: `batch_generate_from_test_cases`.
## Prompt & grounding
`build_design_prompt`: seeded persona + tools + connectors + enriched_instruction (tool/trigger/category hints). Grounding 7/8.
## Code quality (wrapping · logging · caching)
Per-case status events; run-registry dedupe. Weak: regex extraction; feasibility scored AFTER LLM (no feedback to model). Global batch timeout (one hang stops all).
## Findings
- design: no cross-case consistency (each case independent → feature drift).
- quality: feasibility decoupled from LLM (no fix-pass loop on failure).
- reliability: per-case timeout missing.
