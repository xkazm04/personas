---
id: team-synthesis-composition
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/team_synthesis.rs:63
wrapper: spawn_claude_and_collect
provider: claude   model: claude-sonnet-4-6 (hardcoded, line 20)
schema: weak — SynthesisResponse (role enum not validated)
grounding: 6/8
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]", "[[hobbyist-power]]"]
---
## What it does
Team composition: user request → select 2–5 passed templates, assign roles (orchestrator/worker/reviewer/router), define data-flow connections → team JSON. Entry: `synthesize_team`.
## Prompt & grounding
`build_synthesis_prompt`: query (RAW) + passed templates (instruction ≤200 chars, connectors, category). Grounding 6/8.
## Code quality (wrapping · logging · caching)
Stateless, no cache, minimal telemetry. Role enum is a String (parse breaks on unlisted role).
## Findings
- security/grounding: query NOT sanitized (unlike smart_search) — injection surface. Mirror smart_search's guards.
- grounding: templates not weighted by quality score (barely-passed ranks equal to high-quality).
- code: validate the role enum on deserialize.
