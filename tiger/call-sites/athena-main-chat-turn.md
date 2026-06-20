---
id: athena-main-chat-turn
type: tiger/call-site
modality: text
file: src-tauri/src/companion/session.rs:521
wrapper: run_cli (base_cli_invocation, --resume for continuity)
provider: claude   model: routing / account default (--resume keeps state)
schema: no — free-form chat; embedded JSON ops parsed by dispatcher
grounding: 4/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[non-english-user]]"]
---
## What it does
The companion apex: the Athena chat turn. 5-layer system prompt (constitution + identity + observability digest + hybrid-retrieved memory + optional synthesis briefing) → `claude --print stream-json`, optionally resuming prior session. Dispatches ops (approval cards, navigations), persists turn as episodes.
## Prompt & grounding
System composed in companion/prompt.rs:140; retrieval via brain::retrieval::retrieve (embeddings when `ml`); recall-synthesis gate at recall_synthesis.rs:136. Grounding 4/5.
## Code quality (wrapping · logging · caching)
--resume continuity with stale-session self-heal retry (session.rs:541). 300s timeout. Turn → companion_turn ledger (origin/model/tokens). No structured schema (brace-match op parsing).
## Findings
- code 4/5: strong retrieval→synthesis→dispatch→persist pipeline.
- model: chat model NOT explicitly pinned — rides account default (opus-4-8[1m]); cost lever if pinned.
- value: the primary user-facing AI surface.
