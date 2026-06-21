---
id: recipe-generation
type: tiger/call-site
modality: text
file: src-tauri/src/commands/recipes/recipe_generation.rs:28
wrapper: ai_artifact_flow (build_credential_task_cli_args)
provider: claude   model: (via build_credential_task_cli_args)
schema: yes — extract_recipe_generation_result (name + prompt_template keys)
grounding: 1/3
quality_score: 2
code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[content-marketer]]", "[[non-english-user]]", "[[sales-rep]]", "[[solo-founder]]"]
---
## What it does
LLM recipe generation: workflow intent → researches a credential's API → reusable recipe (prompt template + input schema + example). Extracted as JSON.
## Prompt & grounding
`build_recipe_generation_prompt`: service type + description + research/design/test/example tasks. Grounding 1/3 (no API docs provided — training-data only).
## Code quality (wrapping · logging · caching)
Generic harness. 300s timeout. Weak schema check (key presence only). No cache.
## Findings
- grounding 1/3: "research available endpoints" with no docs → hallucination risk; feed real connector/API docs.
- model: opaque.
- code 4/5: harness fine; schema validation thin.
