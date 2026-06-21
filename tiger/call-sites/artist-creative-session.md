---
id: artist-creative-session
type: tiger/call-site
modality: text
file: src-tauri/src/commands/artist/mod.rs:474
wrapper: cli_text (background job, build_cli_args + stdin pipe)
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 551)
schema: no — streamed output
grounding: 0/5
quality_score: 2
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[content-marketer]]"]
---
## What it does
Background creative session (image gen / 3D / Blender MCP). Streams output to the frontend. Entry: `run_creative_cli` (line 543).
## Prompt & grounding
Inline system + user request + conditional MCP/image-gen playbook. No external grounding doc. 600s timeout.
## Code quality (wrapping · logging · caching)
Stdin-piped (arg-length safe). Progress lines emitted. No token accounting. No cache.
## Findings
- code 4/5: clean spawn; no telemetry.
- model: hardcoded Sonnet — no fallback/A-B.
- grounding 0/5: playbook is hardcoded; would benefit from brand/asset grounding.
