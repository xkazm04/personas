---
id: kpi-binding-compose-procedure
type: tiger/call-site
modality: text
file: src-tauri/src/engine/kpi_binding.rs:424
wrapper: cli_text (UNTRACKED) + recipe cache
provider: claude   model: claude-sonnet-4-6
schema: yes — kpi_procedure envelope (parse_procedure, line 380)
grounding: 6/8
quality_score: 3
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[finance-analyst]]", "[[hobbyist-power]]"]
---
## What it does
Composes a single-request HTTP procedure to measure a connector KPI. Recipe hit (e.g. posthog/unique_visitors) is instant; miss asks the LLM (1 retry).
## Prompt & grounding
`build_prompt` (line 445): metric-type contract + connector brief + decrypted cred field KEYS (placeholders only) + KPI name/desc. Grounding 6/8.
## Code quality (wrapping · logging · caching)
Compile-time recipe cache (one of the few caches). 2-attempt retry. Secrets rendered at EXEC time, never persisted. check_invariants validates extracted number.
## Findings
- code 4/5: recipe cache + retry + secret hygiene are exemplary.
- value: powers live KPI measurement from connectors.
- model: Sonnet; recipe path already free.
