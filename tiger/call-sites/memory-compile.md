---
id: memory-compile
type: tiger/call-site
modality: text
file: src-tauri/src/commands/core/memory_compile.rs:145
wrapper: claude_cli_invocation (-p -, --max-turns 1)
provider: claude   model: routing
schema: yes — [{title,body,source_ids}] (extract_json_array, line 347)
grounding: 6/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Synthesizes 1–5 "wiki article" memories from a persona's recent episodic memories (≤200). Filters compiled entries (no recursion). Persists as fact memory (tags=[compiled, wiki]).
## Prompt & grounding
Memory list as JSON; rule: ≥2 sources, no hallucinated ids. 512KB prompt cap. Grounding 6/8 (episodic only).
## Code quality (wrapping · logging · caching)
Strict source validation. 180s timeout, kill-on-timeout. Stdin in separate task (deadlock-safe). No tracing. No cache.
## Findings
- code 3/5: solid source validation; no telemetry.
- grounding: episodic only (no execution/project context).
- value: memory hygiene → durable knowledge.
