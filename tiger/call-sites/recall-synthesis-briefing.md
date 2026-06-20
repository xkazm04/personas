---
id: recall-synthesis-briefing
type: tiger/call-site
modality: text
file: src-tauri/src/companion/brain/recall_synthesis.rs:136
wrapper: call_claude_oneshot (base_cli_invocation, ephemeral)
provider: claude   model: claude-opus-4-8 (pinned, line 279)
schema: yes — {briefing:{...}} (line 250)
grounding: 3/5
quality_score: "—"
code_score: 4
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[researcher]]"]
---
## What it does
When raw retrieval chunks exceed ~5000 tokens, fold them into a focused "what matters this turn" briefing (200–300 tokens). Budget-gated, off-by-default, best-effort (degrades to raw chunks).
## Prompt & grounding
Current message + recall sections (episodes/facts/goals/procedurals/backlog/doctrine) verbatim; compresses (does not retrieve). Grounding 3/5 (compression, not retrieval).
## Code quality (wrapping · logging · caching)
Budget gate before call; 60s timeout; graceful fall-through. Tolerant JSON (field defaults). Minimal tracing.
## Findings
- code 4/5: well-gated; duplicates CLI-arg building with main chat (consolidate).
- model: Opus justified (synthesis quality); benchmark vs Sonnet.
- value: keeps the chat prompt within budget.
