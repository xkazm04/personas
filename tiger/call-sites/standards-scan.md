---
id: standards-scan
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/standards_scan.rs:177
wrapper: direct Command spawn (build_cli_args(None,None))
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 186)
schema: yes — standards_finding protocol (norm-clamped fields)
grounding: 2/8
quality_score: 2
code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]"]
---
## What it does
One-shot scan: embedded `standards_ruleset.md` assessed against the live repo → one finding per rule. Full-replace each run.
## Prompt & grounding
`build_standards_prompt` (line 80): ruleset verbatim + 1:1 rule-to-finding instruction. No project history/team memory. Grounding 2/8 (ruleset only).
## Code quality (wrapping · logging · caching)
No tracing spans (stderr only). Invalid category/status/severity silently → defaults (masks hallucination). No cache.
## Findings
- code 3/5: mechanical checklist; field-normalization hides bad output.
- grounding: no "why this matters" business context.
- model: hardcoded Sonnet; benchmark candidate.
