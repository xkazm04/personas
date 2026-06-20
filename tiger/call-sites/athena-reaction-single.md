---
id: athena-reaction-single
type: tiger/call-site
modality: text
file: src-tauri/src/companion/athena_reaction.rs:236
wrapper: cli_decide → cli_text_tracked
provider: claude   model: claude-sonnet-4-6
schema: yes — athena_channel envelope (parse_athena_decision, line 547)
grounding: 4/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Athena reacts to a single dev moment (PR awaiting_review / goal shipped / QA bounce): whether to post to the team channel, message, rationale, escalation. Default react=false.
## Prompt & grounding
`build_reaction_prompt` (line 236): signal headline/kind + artifact title + detail (≤600) + recent channel history (≤8) + team ledger (≤8). Grounding 4/5.
## Code quality (wrapping · logging · caching)
Ledger-tracked (trigger=reaction). Tolerant brace-match parse. Audit footer on every message. Declines logged. ≤1 signal/team/12h.
## Findings
- code 4/5: restraint well-signaled + auditable.
- grounding: no multi-turn team-pattern memory (8-msg window).
- model: Sonnet appropriate (fast decision).
