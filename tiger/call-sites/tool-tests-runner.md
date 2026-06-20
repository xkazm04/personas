---
id: tool-tests-runner
type: tiger/call-site
modality: text
file: src-tauri/src/engine/build_session/tool_tests.rs:39
wrapper: CliProcessDriver (build session sub-call)
provider: claude   model: routing
schema: weak — test_plan JSON not validated against a schema
grounding: 6/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[software-developer]]"]
---
## What it does
During a build session, LLM generates real curl/API test commands (test_plan) for a persona's tools to verify they work. Sends agent_ir + tool names.
## Prompt & grounding
agent_ir + tool list → test_plan JSON with curl commands. Grounding 6/8.
## Code quality (wrapping · logging · caching)
No self-repair; test_plan shape unchecked. Inherits build-session telemetry context.
## Findings
- code 3/5: validate test_plan shape; add self-repair.
- value: gates the "is this connector actually wired" UX during build.
