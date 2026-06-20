---
id: obsidian-semantic-lint
type: tiger/call-site
modality: text
file: src-tauri/src/commands/obsidian_brain/semantic_lint.rs:21
wrapper: spawn_claude_and_collect (ai_artifact_flow)
provider: claude   model: settings SEMANTIC_LINT_MODEL_DEFAULT
schema: yes — RawSemanticLint (line 68)
grounding: 3/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[researcher]]"]
---
## What it does
LLM semantic lint of an Obsidian vault: ≤120 notes / ≤140k chars → inconsistencies, missing pages, proposed links, knowledge gaps. Opt-in; user reviews.
## Prompt & grounding
`build_vault_summary` (line 117): per-note title/snippet/wikilinks → 4 JSON arrays. Grounding 3/5 (vault structure).
## Code quality (wrapping · logging · caching)
Config-registry model (good hygiene). Deterministic sampling. 90s timeout. Vault summary rebuilt each pass (no cache). MAX_PROMPT_CHARS=140k silent truncation.
## Findings
- code 4/5: config-driven model; silent truncation on large vaults.
- grounding: structure-only (no note bodies beyond snippets).
- model: settings-driven; benchmark candidate.
