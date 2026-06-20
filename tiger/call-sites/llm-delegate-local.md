---
id: llm-delegate-local
type: tiger/call-site
modality: text
file: src-tauri/src/mcp_server/tools.rs
wrapper: MCP tool (llm_delegate → local model)
provider: local (BYOM / Ollama, e.g. lfm2.5)
schema: tool-call schema
grounding: n/a (delegated sub-prompt)
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[hobbyist-power]]"]
---
## What it does
The BYOM "mixed engine" tool: when engine_mode=mixed, arms an `llm_delegate` MCP tool so the Claude orchestrator can hand a sub-task to a LOCAL model (lfm2.5 ~53 tok/s). Resilience-proven (survived Ollama death mid-run); NOT a cost lever (prompt machinery dominates).
## Prompt & grounding
Sub-prompt supplied by the orchestrator at tool-call time. Grounding inherited from the calling persona's context. Memory-poisoning gotcha documented.
## Code quality (wrapping · logging · caching)
MCP tool wiring (engine/cli_mcp_config.rs). Local-model latency/cost not stamped into the parent execution. No cache.
## Findings
- code 3/5: tool plumbing solid; local spend invisible.
- model: the only `provider: local` site — Lens-3 here is "is local quality acceptable for delegated sub-tasks".
- value: resilience + offline path, not cost savings.
