---
id: kpi-compose-measure
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/kpi_compose.rs:356
wrapper: direct Command spawn (cwd=project root)
provider: claude   model: claude-sonnet-4-6
schema: yes — kpi_measure envelope (extract_result, line 442)
grounding: 4/5
quality_score: 4
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[finance-analyst]]"]
---
## What it does
Composes + tests a codebase measurement for a KPI: builds a shell command (cwd=root), parses a number via a named strategy (coverage_pct/count_lines/regex/json_path).
## Prompt & grounding
`build_measure_compose_prompt` (line 473): KPI metadata + platform shell hint + parse strategies; model iterates IN the repo until the command works. Grounding 4/5.
## Code quality (wrapping · logging · caching)
Compile-time shell adaptation (Windows cmd vs sh). 600s timeout. Cancellation token. NO cost telemetry. No cache.
## Findings
- code 4/5: deterministic measurement contract; no telemetry.
- value: turns a proposed KPI into a live self-measuring metric.
- model: Sonnet; benchmark candidate.
