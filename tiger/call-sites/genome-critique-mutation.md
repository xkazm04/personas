---
id: genome-critique-mutation
type: tiger/call-site
modality: text
file: src-tauri/src/engine/genome_critique.rs:36
wrapper: run_critique_cli (temp driver)
provider: claude   model: default (Sonnet)
schema: yes — parse_rewrite_response (genome_critique.rs:173), hard fail on mismatch
grounding: 5/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[hobbyist-power]]"]
---
## What it does
Evolution mutation operator: textual-gradient critique-and-rewrite of a persona's prompt segments from top-K failure patterns. Entry: `mutate_via_critique`.
## Prompt & grounding
"Textual-gradient prompt engineer" system + full current prompt + ranked failure patterns → JSON array of {index, new_text}. 60s timeout. Grounding 5/5.
## Code quality (wrapping · logging · caching)
Hard-fail-on-bad-parse is correct (a bad mutation would corrupt the genome). No telemetry. Deterministic failure ranking.
## Findings
- code 4/5: tight; 60s timeout may be short for complex rewrites.
- model: Sonnet appropriate for prompt-engineering.
- value: drives diversity in breeding; cost scales per variant.
