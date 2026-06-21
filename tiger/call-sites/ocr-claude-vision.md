---
id: ocr-claude-vision
type: tiger/call-site
modality: vision
file: src-tauri/src/commands/ocr/mod.rs:476
wrapper: cli_text (Claude Code CLI binary + stdin base64 pipe)
provider: claude   model: claude-code-cli (subscription, no API key)
schema: yes — OcrDocument persistence
grounding: 0/3
quality_score: 2
code_score: 5
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[finance-analyst]]"]
---
## What it does
Claude-CLI OCR alternative: base64 file piped to stdin with prompt → stdout text. Uses the user's subscription. Drive-scoped variant available.
## Prompt & grounding
`OCR_SYSTEM_PROMPT` + MIME + basename + base64; "output ONLY extracted text". Grounding 0/3.
## Code quality (wrapping · logging · caching)
Binary discovery (which/PATH); Windows cmd.exe wrap; EOF on stdin close; 300s timeout. token_count: None (no accounting). No cache.
## Findings
- code 5/5: robust spawn; no token telemetry.
- model: "claude-code-cli" is the wrapper, not a model — no swap path.
- value: the subscription (no-key) OCR option vs Gemini.
