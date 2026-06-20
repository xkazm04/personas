---
id: companion-consolidation
type: tiger/call-site
modality: text
file: src-tauri/src/companion/brain/consolidation.rs:710
wrapper: call_claude_oneshot (base_cli_invocation, UNTRACKED)
provider: claude   model: claude-opus-4-8 (pinned, line 833)
schema: yes — {summary, proposals[...]} strict validate (line 200)
grounding: 4/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: []
---
## What it does
Manual consolidation: 80 recent episodes + ≤200 existing facts → propose semantic-fact add/update/contradict, cited to episodes. Proposals land pending for user review (no auto-apply). Decay + per-scope prune (cap 500) afterward.
## Prompt & grounding
`build_consolidation_prompt` (line 710): 6 non-negotiable rules (cite sources, supersedes_id, importance/confidence scales) + existing facts + episodes. Grounding 4/5.
## Code quality (wrapping · logging · caching)
Strict schema (sources-required; invalid skipped + warned). Fuzzy embedding dedup on apply. 300s timeout. NOT ledger-tracked (call_claude_oneshot, not cli_text_tracked) — spend unattributed.
## Findings
- code 4/5: citation enforcement + user-in-loop are strong.
- observability: not in companion_turn → Opus spend invisible.
- model: Opus justified (carry-forward/replace reasoning); benchmark vs Sonnet.
