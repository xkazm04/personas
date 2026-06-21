---
id: context-generation
type: tiger/call-site
modality: text
file: src-tauri/src/commands/infrastructure/context_generation.rs:689
wrapper: direct Command spawn (+ delta mode + lazy clear)
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 817)
schema: yes — context_map_* protocol (normalize_category/domain)
grounding: 8/8
quality_score: 4
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[sales-rep]]", "[[software-developer]]"]
---
## What it does
Builds/rescans the project Context Map (business-feature groups × contexts). Delta mode (changed files only) cuts tokens ~10×. Emits context-map.json + managed CLAUDE.md section.
## Prompt & grounding
`build_context_generation_prompt` (line 67): first-scan vs rescan vs delta; business-domain rules + field enums. SHA256 file-hash cache (skip on no change). Grounding 8/8.
## Code quality (wrapping · logging · caching)
File-hash cache (the best caching in the app). Lazy-clear (waits for first output before destroying old map). Single-flight guard. 30-min timeout, partial-success re-seeds hashes. Subscription-auth forced. No cost telemetry.
## Findings
- code 4/5: delta + lazy-clear + hash cache are exemplary; no cost telemetry.
- model: hardcoded Sonnet; benchmark candidate.
- value: the substrate every other scanner reads (context-map.json).
