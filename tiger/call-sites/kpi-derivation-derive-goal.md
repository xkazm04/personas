---
id: kpi-derivation-derive-goal
type: tiger/call-site
modality: text
file: src-tauri/src/engine/kpi_derivation.rs:302
wrapper: cli_text (athena_reaction.rs:419, UNTRACKED)
provider: claude   model: claude-sonnet-4-6
schema: yes — kpi_goal envelope (parse_kpi_goal, line 187)
grounding: 8/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
When a KPI is off-track (pace/critical/floor breach), derive one concrete team goal — or skip if nothing would plausibly move the metric.
## Prompt & grounding
`build_derivation_prompt` (line 204): KPI metadata + 10 recent measurements + ≤20 codebase contexts + ≤8 recent goals (dedup) + floor-breach framing. Grounding 8/8.
## Code quality (wrapping · logging · caching)
Skip persists last_skip_at/rationale (avoids re-spend). Signed provenance footer. context_id hallucination guard. Goal-signal soft-link. UNTRACKED spend (cli_text, not cli_text_tracked). No retry.
## Findings
- code 4/5: strong guard rails; spend not in companion_turn ledger.
- value: the KPI→goal steering loop.
- model: Sonnet; benchmark vs Haiku.
