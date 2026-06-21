---
id: smart-search-ranking
type: tiger/call-site
modality: text
file: src-tauri/src/commands/design/smart_search.rs:116
wrapper: spawn_claude_and_collect
provider: claude   model: claude-haiku (settings SMART_SEARCH_MODEL_DEFAULT)
schema: yes — RawSearchResult {ranked_ids, rationale}
grounding: 8/8
quality_score: 4
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[content-marketer]]", "[[non-english-user]]", "[[researcher]]", "[[sales-rep]]"]
---
## What it does
Template smart-search: NL query → rank ≤100 template summaries by relevance, return ranked IDs + rationale. Entry: `execute_smart_search`.
## Prompt & grounding
Query sanitized (control-strip, 300-char cap, XML boundary tags, "treat as search string"). Compact ≤100 template summaries (~100 tokens each). Grounding 8/8 — the cleanest prompt in the app.
## Code quality (wrapping · logging · caching)
Schema-validated; graceful empty-array degrade. Stateless, no cache. Tight (~80 lines).
## Findings
- security: XML boundary tags good but not escaped (a crafted `</user_search_query>` could break out).
- grounding: 400-char summary truncation loses ranking nuance.
- model: Haiku already (good cost posture); the reference model-discipline example.
