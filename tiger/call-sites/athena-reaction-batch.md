---
id: athena-reaction-batch
type: tiger/call-site
modality: text
file: src-tauri/src/companion/athena_reaction.rs:596
wrapper: cli_text_tracked
provider: claude   model: claude-sonnet-4-6
schema: yes — athena_channel_batch envelope (parse_athena_batch, line 572)
grounding: 3/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Batch reaction: multiple pending signals (≤1/team) in one CLI call → per-signal verdicts. Shipped 2026 to cut calls/tick (1 call instead of N).
## Prompt & grounding
`build_batch_prompt` (line 596): numbered per-team signal blocks; history capped tighter (5/team if >1). Grounding 3/5.
## Code quality (wrapping · logging · caching)
Ledger-tracked (trigger=reaction_batch). Missing verdict = safe decline. Per-verdict logging.
## Findings
- code 4/5: batching is the right cost move.
- grounding: 5-msg/team cap may lose repeating-pattern context.
- value: no cross-team pattern reasoning in the prompt.
