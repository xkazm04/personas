---
id: ocr-gemini-vision
type: tiger/call-site
modality: vision
file: src-tauri/src/commands/ocr/mod.rs:182
wrapper: direct reqwest::post (Generative Language API)
provider: gemini   model: gemini-3.5-flash (default, line 26)
schema: yes — GeminiResponse (line 98)
grounding: 0/2
quality_score: "—"
code_score: 5
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[finance-analyst]]"]
---
## What it does
The one non-Claude text path: HTTP POST to Google's generateContent. Base64 file → extracted text. Cancellable.
## Prompt & grounding
`OCR_SYSTEM_PROMPT` (line 27) "extract ALL text, preserve structure"; optional user override. Vision model is the oracle. Grounding 0/2.
## Code quality (wrapping · logging · caching)
Idiomatic reqwest; API key in header (not URL); 20MB cap; reads token_count from usage metadata (rare telemetry). No cache.
## Findings
- code 5/5: cleanest external-provider integration in the app.
- model: hardcoded gemini-3.5-flash floor — benchmark vs Claude-vision (ocr-claude-vision) for consistency.
- security: user `prompt` override not injection-validated.
