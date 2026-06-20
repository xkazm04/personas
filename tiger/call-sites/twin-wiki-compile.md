---
id: twin-wiki-compile
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/twin.rs:200
wrapper: cli_text (tokio Command, background)
provider: claude   model: routing (build_cli_args, opaque here)
schema: no — raw CLI output → file writes
grounding: 1/3
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[researcher]]"]
---
## What it does
Digital-twin wiki compile: twin profile/tone/comms/facts → markdown wiki files under ~/Personas/twin-wikis/{id}/.
## Prompt & grounding
Built by caller; twin profile + tone + recent comms + distilled facts (TwinRecallBundle). Grounding 1/3.
## Code quality (wrapping · logging · caching)
Strong path sandbox (resolve_wiki_dir rejects abs/.. / symlink escape). No schema validation of output; no transactional rollback. No cache.
## Findings
- code 3/5: sandbox strong; output content unchecked (malformed md / frontmatter injection possible).
- model: opaque.
- value: persistent twin knowledge base.
