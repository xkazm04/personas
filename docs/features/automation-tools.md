# Automation Tools

The `commands/tools/` backend module groups four related surfaces: tool definitions, external automations, AI-driven automation design, and platform integrations. They share a database neighborhood (`db/repos/resources/{tools,automations,connectors}`), a credential model (vault-stored), and a connector-driven prompt-generation pipeline (`run_ai_artifact_task`).

## What lives where

| File | Concern |
| --- | --- |
| `tools.rs` | Tool-definition CRUD, persona ↔ tool assignment (single + bulk), usage analytics, direct tool invocation |
| `automations.rs` | External automation CRUD, blast-radius analysis, run history, trigger + webhook-test |
| `automation_design.rs` | AI-driven automation design — streams a design through `run_ai_artifact_task` based on persona context, available tools/connectors/credentials, and existing automations |
| `deploy_automation.rs` | Deploy a designed automation to its target platform |
| `github_platform.rs` | GitHub-platform calls (`list_repos`, `check_permissions`) |
| `n8n_platform.rs` | n8n-platform calls (`list_workflows`, `activate/deactivate/create_workflow`, `trigger_webhook`) |
| `triggers.rs` | Trigger CRUD + cron preview + cron fire-times — see [events/README.md](events/README.md) and [schedules.md](schedules.md) |

`mod.rs` re-exports the seven submodules; the canonical home for trigger/webhook event behavior remains the events/triggers feature pair.

## Tool definitions

`tools.rs` is the canonical store for tool definitions used by personas. Public commands:

| Family | Commands |
| --- | --- |
| Definitions | `list_tool_definitions`, `get_tool_definition`, `get_tool_definitions_by_category`, `create_tool_definition`, `update_tool_definition`, `delete_tool_definition` |
| Assignment | `assign_tool`, `unassign_tool`, `bulk_assign_tools`, `bulk_unassign_tools` |
| Analytics | `get_tool_usage_summary`, `get_tool_usage_over_time`, `get_tool_usage_by_persona`, `get_tool_performance_summary` |
| Direct invoke | `invoke_tool_direct` |

The frontend consumer is the personas/agents surface — tool assignments determine what each persona can call during execution. Assignment changes are surfaced in the persona editor.

## Automations

External automations are user-owned workflows that personas can trigger as side effects. Storage is in `automations` table via `db/repos/resources/automations`.

| Command | Behavior |
| --- | --- |
| `list_automations` / `get_automation` | Read |
| `create_automation` / `update_automation` / `delete_automation` | Write |
| `automation_blast_radius` | Returns the personas, triggers, and credentials affected by a change to this automation |
| `trigger_automation` | Runs the automation by id |
| `test_automation_webhook` | Sends a test payload to the webhook target without persisting a run |
| `get_automation_runs` | Run history |
| `deploy_automation` (in `deploy_automation.rs`) | Pushes the automation to its platform target (e.g. n8n create_workflow) |

## Automation design

`automation_design.rs` runs an AI-assisted design pass via `run_ai_artifact_task` (the same primitive used for credential design). It streams progress events:

| Event | Payload |
| --- | --- |
| `automation-design-status` | High-level lifecycle (`analyzing` → … → complete) |
| `automation-design-output` | Streamed design content |

The design id field is `design_id`; the timeout is 300s. Frontend consumers attach via `eventBridge` and surface the streaming text in the design wizard.

| Command | Behavior |
| --- | --- |
| `start_automation_design` | Begins a design run with persona name, description, tools/connectors/credentials/automations summaries |
| `cancel_automation_design` | Cancels the running design |

The prompt builder pulls in `tools_summary`, `connectors_summary`, `credentials_summary`, and `existing_automations_summary` — so the model designs against what the user actually has in their vault, not a generic catalog.

## Platform integrations

These are thin connectors that wrap a third-party platform's API. They share the credential-resolution path with the rest of the vault.

| File | Commands |
| --- | --- |
| `github_platform.rs` | `github_list_repos`, `github_check_permissions` |
| `n8n_platform.rs` | `n8n_list_workflows`, `n8n_activate_workflow`, `n8n_deactivate_workflow`, `n8n_create_workflow`, `n8n_trigger_webhook` |

The n8n integration also powers the [n8n workflow import](events/README.md#n8n-import) flow under `src/features/templates/sub_n8n/`; the platform commands are used both for import (read existing workflows) and for deploy_automation (create new workflows).

## Frontend consumers

| Surface | Usage |
| --- | --- |
| Persona editor | Tool assignment — `assign_tool`, `unassign_tool`, `bulk_*`, `list_tool_definitions` |
| Automations UI | `list_automations`, `get_automation_runs`, `automation_blast_radius`, `trigger_automation`, `test_automation_webhook` |
| Automation design wizard | `start_automation_design`, `cancel_automation_design`, with eventBridge subscription for streaming events |
| n8n wizard | `n8n_*` commands during import + `deploy_automation` during finalize |

## Known gaps

- `invoke_tool_direct` exists for diagnostic / dev-tools use; it bypasses the persona context that normal tool calls flow through. Treat it as a tester surface, not a production path.
- Platform integrations are GitHub and n8n only — adding a new platform means a new `*_platform.rs` file plus catalog wiring.
