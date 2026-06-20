---
id: credential-design
type: tiger/call-site
modality: text
file: src-tauri/src/commands/credentials/credential_design.rs:44
wrapper: ai_artifact_flow::run_ai_artifact_task (build_credential_task_cli_args)
provider: claude   model: (via build_credential_task_cli_args)
schema: yes — extract_credential_design_result (JSON)
grounding: 2/5
quality_score: "—"
code_score: 5
recommended_model: "—"
status: discovered
last_scanned: 2026-06-20
characters: ["[[enterprise-admin]]"]
---
## What it does
AI connector design: NL intent ("Connect to Stripe API") → structured connector schema (name, fields, healthcheck). Background job, audit-logged.
## Prompt & grounding
`build_credential_design_prompt`: instruction + existing connectors. Grounding 2/5.
## Code quality (wrapping · logging · caching)
Generic ai_artifact_flow harness; PID registry for cancellation; audit log captures intent. 600s timeout. No cache.
## Findings
- code 5/5: the cleanest plugin harness (cancellation + audit + pluggable extract).
- model: opaque (deferred to build_credential_task_cli_args).
- quality: JSON schema-matched but no semantic validation (field uniqueness).
