---
id: msg-triage-athena
type: tiger/call-site
modality: text
file: src-tauri/src/companion/proactive/message_triage.rs:282
wrapper: cli_text_tracked
provider: claude   model: claude-sonnet-4-6
schema: yes — athena_messages envelope
grounding: 4/5
quality_score: 4
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[support-lead]]"]
---
## What it does
Autonomous message triage: batches unread persona_messages (≤20/tick, oldest-first) → done / digest / attention. Mark-read or keep-unread accordingly.
## Prompt & grounding
`build_triage_prompt` (line 121): id/from/title/priority/created/content-head (≤400 chars). CODE floor: high/urgent/critical forced to `attention` (effective_action, line 111). Grounding 4/5.
## Code quality (wrapping · logging · caching)
Ledger-tracked (trigger=msg_triage). Cursor advances only past processed. Per-item audit annotation. Wake-window bypass for priority.
## Findings
- code 4/5: priority floor is load-bearing (model can't swallow money/security/data-loss msgs).
- grounding: no semantic/user-preference grounding (metadata only).
- value: drains the inbox without burying urgent items.
