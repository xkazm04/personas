---
id: idea-scanner
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/idea_scanner.rs:625
wrapper: direct Command spawn (build_cli_args(None,None))
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 627)
schema: yes — scan_idea/scan_summary protocol (parse_idea_protocol, line 228)
grounding: 8/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Analyzes the codebase against selected scan-agents (security-auditor, code-optimizer, …) → 3–8 improvement ideas/agent → DevIdea records.
## Prompt & grounding
`build_idea_scan_prompt` (line 66): agent metadata + scoped context summary + rejected-idea titles (learning loop) + team ledger (settled constraints) + granularity hint. Grounding 8/8.
## Code quality (wrapping · logging · caching)
Score-range validation (1..=10), drops malformed. Backlog CAP guard. 20-min timeout (partial success preserved). NO token/cost telemetry. No cache.
## Findings
- code 4/5: strong grounding (team ledger) + rejection learning; zero cost telemetry.
- model: hardcoded Sonnet; benchmark vs Haiku for idea quality.
- value: the proactive backlog engine.
