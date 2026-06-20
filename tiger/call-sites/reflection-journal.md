---
id: reflection-journal
type: tiger/call-site
modality: text
file: src-tauri/src/companion/brain/reflection.rs:42
wrapper: call_claude_oneshot (ephemeral)
provider: claude   model: claude-opus-4-8 (pinned, line 197)
schema: no — free-form prose
grounding: 3/5
quality_score: "—"
code_score: 3
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[researcher]]"]
---
## What it does
Weekly first-person reflection journal: reads 60 recent episodes, observes patterns (preoccupations, shifts, unresolved threads), writes a markdown note + companion_node row.
## Prompt & grounding
First-person 4–8 paragraphs, no bullets, no unsubstantiated claims; episodes verbatim; optional operator steer. Grounding 3/5 (episodes only, no facts/goals).
## Code quality (wrapping · logging · caching)
180s timeout; disk + DB persistence. Minimal logging. Prose output (no schema parse).
## Findings
- model (COST): Opus is overkill for prose observation — Sonnet likely sufficient. Top model-downgrade candidate.
- grounding: could be richer with facts/goals alongside episodes.
- code 3/5: simple + robust.
