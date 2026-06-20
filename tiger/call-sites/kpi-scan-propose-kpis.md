---
id: kpi-scan-propose-kpis
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/kpi_scan.rs:420
wrapper: direct Command spawn (build_cli_args(None,None), cwd=project root)
provider: claude   model: claude-sonnet-4-6
schema: yes — kpi_proposal envelope (line-delimited)
grounding: 7/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[software-developer]]"]
---
## What it does
Batch-proposes 0–8 KPIs for a project by exploring the repo (cwd=root), context map, existing+archived KPIs, connectors. Proposals land status='proposed' for the review queue.
## Prompt & grounding
`build_kpi_scan_prompt` (line 122): context-map markdown + active KPIs (dup-flagged) + archived KPIs (re-propose blocked) + connectors + live repo exploration. Grounding 7/8.
## Code quality (wrapping · logging · caching)
Backpressure guard (refuses if pending ≥ 10). Case-insensitive dup detection. Group/context hallucination → safe fallback. 900s timeout. NO token/cost telemetry. No cache.
## Findings
- code 4/5: great guard rails; zero cost telemetry (15-min Sonnet spawns invisible).
- value: feeds the KPI backlog; live-verified historically.
- model: Sonnet; benchmark vs Haiku for proposal quality.
