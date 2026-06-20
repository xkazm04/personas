---
name: Sofía, Spanish-speaking User
type: tiger/character
segment: localization
maps_to: ["[[build-session-runner]]", "[[athena-main-chat-turn]]", "[[persona-execution-main]]", "[[recipe-generation]]", "[[smart-search-ranking]]"]
references: ["training-data: i18n output quality, mixed-language LLM-response friction, English-fallback fatigue — the bar a native Spanish speaker wouldn't wince at sets"]
last_scanned: 2026-06-20
---
## Who they are / Background / Voice
Sofía runs marketing for a small company in Mexico City. Her English is functional, but an output that flips between Spanish and English mid-flow makes her doubt whether she understood what she just read — especially around credentials or sending messages. She's the same kind of builder as Dani/Priya, just operating in Spanish. Voice (in Spanish): practical, a little wary of half-translated tools — "¿esto está en español o no?" She trusts the product more when her own language is respected end-to-end, including in what the model writes back.
## Jobs to be done (what they hire the MODEL OUTPUT for)
- `build-session-runner` building a working Persona where the generated config/copy comes back in Spanish, not English.
- `athena-main-chat-turn` conversing with the assistant and getting replies that stay in Spanish and stay grounded in her supplied context.
- `persona-execution-main` producing drafted output (posts, messages) in fluent, native Spanish.
- `recipe-generation` / `smart-search-ranking` returning use-cases/results whose generated text and ranking respect her locale.
## Senior-quality bar (the floor the OUTPUT must clear)
Model output quality equal to the English experience — generated text in natural, native Spanish that a native speaker wouldn't wince at, with no English bleed-through on critical content (credentials, send confirmations, errors). Grounding must survive translation: it still names her real entity/data, doesn't drop specifics, and doesn't silently revert to English mid-response.
## Time-saved (motivation)
- Same as a non-technical builder — but language friction in the output directly costs adoption. If she has to re-read in English to be sure, it's slower than a native tool — finding.
## Scored acceptance criteria (applied IDENTICALLY every run, to the OUTPUT)
- [ ] grounded in MY real context (names my supplied entity/data, no placeholders)
- [ ] senior-grade (specific, correct, not generic)
- [ ] worth the latency/cost
- [ ] output stays in native Spanish — no English bleed-through, grounding survives translation
