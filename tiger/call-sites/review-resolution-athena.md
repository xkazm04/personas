---
id: review-resolution-athena
type: tiger/call-site
modality: text
file: src-tauri/src/companion/athena_reaction.rs:973
wrapper: cli_text_tracked
provider: claude   model: claude-sonnet-4-6
schema: yes — athena_review envelope
grounding: 5/5
quality_score: 4
code_score: 5
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]", "[[support-lead]]"]
---
## What it does
High-stakes: breaks a parked `awaiting_review` deadlock. One decision/assignment: approve (extra QA round + directive) / incident / abort_retry / goal_shelve / escalate.
## Prompt & grounding
`build_review_resolution_prompt` (line 973): failed steps (QA rounds, error, output ≤900) + goal context (status, %, prior aborts, to-dos) + channel history. Grounding 5/5 — richest in the app.
## Code quality (wrapping · logging · caching)
Ledger-tracked (trigger=review_resolution). Deterministic backstop: ≥2 prior aborts → abort_retry downgraded to goal_shelve (line 1089). Once-per-assignment guard (event recorded FIRST, line 1106).
## Findings
- code 5/5: deterministic backstops + once-only guard are model-best-practice.
- value: prevents fleet deadlock; the keystone autonomy decision.
- model: Sonnet; high-stakes → benchmark Opus upgrade.
