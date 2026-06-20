---
id: template-adoption-transform
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/template_adopt.rs:1363
wrapper: run_claude_prompt_text_inner (n8n_transform/cli_runner.rs:673)
provider: claude   model: claude-sonnet-4 (hardcoded)
schema: yes (section-level) — N8nPersonaOutput
grounding: 6/8
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[solo-founder]]"]
---
## What it does
Adopt a catalog/n8n template into a persona IR: workflow JSON + parsed flow + user context → persona IR mapped back to nodes. Entry: `start_template_adoption_dialog`.
## Prompt & grounding
`build_template_adopt_unified_prompt`: template_name + workflow_json + parser_result + optional prior draft + adjustment_request + connectors + credentials. Grounding 6/8.
## Code quality (wrapping · logging · caching)
Job TTL (10min, cap 50) + resume-running dedupe. Prompt-sanitizer escapes input. Sections not fully schema-validated until promote. Large file (~3500 lines).
## Findings
- grounding: n8n node-types not cross-checked against the tool catalog → LLM invents tools → dead nodes at exec.
- code: sanitizer escapes JSON but doesn't mark it pre-escaped (use XML boundary tags like smart_search).
- grounding: no adoption history/diff across repeat adoptions.
