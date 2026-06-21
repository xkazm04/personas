---
id: build-session-runner
type: tiger/call-site
modality: text
file: src-tauri/src/engine/build_session/runner.rs
wrapper: CliProcessDriver (v3 streaming build-event protocol)
provider: claude   model: persona ModelProfile / routing
schema: yes — v3 event protocol + gate state machine (gates.rs)
grounding: 8/8
quality_score: 3
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[content-marketer]]", "[[non-english-user]]", "[[sales-rep]]", "[[solo-founder]]"]
---
## What it does
The interactive "build a persona from intent" engine. Spawns Claude, streams v3 build events (behavior_core → capability_enumeration → resolution → agent_ir), runs the clarifying-question gate machine, persists draft. Entry: `start_build_session`.
## Prompt & grounding
`build_session_prompt` (session_prompt.rs) over 8 params: intent + credentials + connectors + template_context + language + one_shot + user context (≤8K). Embeds the full v3 capability framework (90+ rules). Grounding 8/8.
## Code quality (wrapping · logging · caching)
Single spawn site; full v3 event parse + gate enforcement; per-phase DB checkpoint. fix_pass.rs catches test failures (not malformed events). Prompt is large (session_prompt.rs ~800 lines) — bloat candidate. No cache (stateful multi-turn).
## Findings
- value/quality: gate-synthesis heuristics (gates.rs) are conservative — intents that should gate (e.g. "monitor emails weekly") can fall through to auto-resolved.
- value: simple-periodic fast-path can auto-pick `review_policy=never` for external-publish (Slack) capabilities — should force a review question.
- code: model_profile not surfaced into the prompt; pasted "use Opus" in context is ignored.
