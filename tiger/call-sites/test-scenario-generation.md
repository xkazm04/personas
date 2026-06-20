---
id: test-scenario-generation
type: tiger/call-site
modality: text
file: src-tauri/src/engine/test_runner.rs:543
wrapper: spawn_cli_and_collect (temp driver, build_cli_args(None,None))
provider: claude   model: default (Sonnet)
schema: no explicit validation — JSON array parse (test_runner.rs:701)
grounding: 7/7
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Generates 3–5 realistic test scenarios for a persona (inputs, expected outputs, mock tool responses). Used in lab + evolution. Entry: `generate_scenarios`.
## Prompt & grounding
Hardcoded "QA engineer" system (test_runner.rs:600) + persona name/desc + structured_prompt sections + tool schemas + use_case filter + optional fixtures. Strict JSON array output. Grounding 7/7.
## Code quality (wrapping · logging · caching)
10-min TTL LRU cache keyed (persona_id, tools-hash, use_case) — skipped when fixtures present (one of the few caches in the app). No schema self-repair (hard JSON fail). No cost/latency telemetry.
## Findings
- code 3/5: good cache, but no self-repair + no telemetry (cost invisible).
- model: Sonnet is fine; Haiku candidate for synthetic scenarios.
- value: cache hit-rate gates evolution iteration speed.
