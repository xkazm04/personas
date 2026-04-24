# `engine/prompt` — runtime persona prompt assembly

**Entry point:** [`assemble_prompt`](./mod.rs) — builds the full system
prompt for a persona execution. Called by `engine::runner::run_execution`
and by several `commands/*` callers (dry-run, test, cloud, twin). The
other modules in this directory are either helpers that feed into
`assemble_prompt` or standalone siblings (resume prompt, advisory prompt,
CLI arg builders).

## Module map

| File | Responsibility | Public to |
|---|---|---|
| [`mod.rs`](./mod.rs) | `ResolvedConnectorHint` + `DisciplineMode` + `assemble_prompt` (~580 lines) + tests. Calls every helper below. | External callers use `engine::prompt::assemble_prompt`. |
| [`capabilities.rs`](./capabilities.rs) | `parse_model_profile`, `render_active_capabilities`, `active_capabilities_fingerprint`, `render_generation_policy_lines`, `build_tool_documentation`. Small derivation helpers shared with non-execution callers. | All `pub`, re-exported at `mod.rs`. |
| [`variables.rs`](./variables.rs) | `replace_variables` — interpolate `{{var}}` placeholders with runtime-sanitised values. | `pub`, re-exported. |
| [`runtime_safety.rs`](./runtime_safety.rs) | `sanitize_runtime_variable`, `wrap_runtime_xml_boundary`, `generate_runtime_nonce`, `is_invisible_runtime_char`, `RUNTIME_CANARY_INSTRUCTION`, `DANGEROUS_TAGS`, `MAX_RUNTIME_VAR_LENGTH`, `RUNTIME_NONCE_COUNTER`. The structural prompt-injection defence. | `pub(super)` only — never call from outside `engine::prompt`. |
| [`cli_args.rs`](./cli_args.rs) | `build_cli_args*`, `build_resume_cli_args*`, `apply_provider_env`, `base_cli_setup`, `resolve_effort`, `DEFAULT_EFFORT`. | `pub`, re-exported. |
| [`resume_prompt.rs`](./resume_prompt.rs) | `assemble_resume_prompt` — lightweight prompt for `--resume` continuations. | `pub`, re-exported. |
| [`advisory.rs`](./advisory.rs) | `build_advisory_prompt` + `ADVISORY_ASSISTANT_PROMPT` — activated when `input_data._advisory` is true. | `pub(super)` (called only from `mod.rs::assemble_prompt`). |
| [`templates.rs`](./templates.rs) | All static prompt strings: `MEMORY_SYSTEM_PREAMBLE`, `PROTOCOL_*`, `EXECUTION_MODE_DIRECTIVE`, `DELIBERATE_MODE_DIRECTIVE`, `PROTOCOL_INTEGRATION_REQUIREMENTS`. | `pub(super)` only. |

## Phases inside `assemble_prompt`

The function reads top-to-bottom as a series of prompt sections appended
in order. Grep for the section header strings (each `prompt.push_str("##
...")` or `prompt.push_str("### ...")`) to jump.

| Section | Source | Gated on |
|---|---|---|
| Header (`# Persona: <name>`) | `persona.name` (variable-substituted) | always |
| Execution mode directive | `EXECUTION_MODE_DIRECTIVE` or `DELIBERATE_MODE_DIRECTIVE` | `persona.execution_discipline` |
| Triggering event | `input_data._event` | present only on event-driven executions |
| Description | `persona.description` (variable-substituted) | non-empty |
| Identity / Instructions | `persona.structured_prompt` OR `persona.system_prompt` | present |
| Active Capabilities | `render_active_capabilities(persona.design_context)` | design_context non-null |
| Tools | `build_tool_documentation(tool)` per tool | tools non-empty |
| Credentials | `credential_hints` | non-empty |
| Connector Usage Reference | `connector_usage_hints` | at least one hint has `overview` |
| Memory System Preamble | `MEMORY_SYSTEM_PREAMBLE` | always |
| Communication Protocols | `PROTOCOL_*` block | always |
| Integration Requirements | `PROTOCOL_INTEGRATION_REQUIREMENTS` | always |
| Runtime Canary | `RUNTIME_CANARY_INSTRUCTION` | always |
| Ambient Desktop Context | `ambient_context` param | `cfg!(feature = "desktop")` + non-empty |
| Current Focus / Use Case | `input_data._use_case` | present |
| Input Data | raw `input_data` | present |

## Invariants

* **Every user-controlled value passes through `sanitize_runtime_variable`.**
  This is the structural prompt-injection defence. If you add a new
  `prompt.push_str(&some_user_value)` without `sanitize_runtime_variable`,
  you've opened a hole. Prefer `wrap_runtime_xml_boundary(tag, value)`
  (which sanitises internally) over raw concatenation.

* **XML boundary tags use a per-execution nonce.** A fresh nonce from
  `generate_runtime_nonce` is attached to every boundary tag so an
  attacker who guesses a tag name can't use that knowledge across
  sessions. Don't hard-code tag names.

* **`DEFAULT_EFFORT = "medium"` is pinned deliberately.** CLI 2.1.94
  changed the tier-dependent default; personas pins medium so behaviour
  is deterministic across account tiers and CLI versions.

* **Language rule goes at the top.** The `LANGUAGE RULE` block in the
  build prompt must precede any prose that the LLM might mirror — the
  LLM takes the language signal from the first non-header sentence it
  sees, not the last.

## Callers (cross-module surface)

Every `pub fn` here is called from somewhere specific. Don't rename
without grepping:

* `engine::runner::run_execution` — `assemble_prompt`, `assemble_resume_prompt`, `build_cli_args`, `build_resume_cli_args`, `apply_provider_env`, `parse_model_profile`, `active_capabilities_fingerprint`, `replace_variables`
* `commands::execution::executions` — `assemble_prompt`, `parse_model_profile`, `active_capabilities_fingerprint`
* `commands::execution::tests` — `assemble_prompt`, `build_cli_args`, `parse_model_profile`
* `commands::design::template_adopt` — `build_cli_args`, `build_resume_cli_args`
* `commands::design::reviews` — `build_cli_args`
* `commands::design::smart_search`, `team_synthesis` — `build_cli_args`
* `commands::infrastructure::{cloud,idea_scanner,twin,task_executor,context_generation}` — `assemble_prompt` / `build_cli_args`
* `commands::credentials::{shared,schema_proposal}` — `build_cli_args`
* `commands::teams::teams` — `build_cli_args`
* `gitlab::converter` — `assemble_prompt`
* `engine::build_session::*` — reads `build_cli_args` for the build CLI
  invocation
* `engine::ollama` — builds its own CliArgs via different helpers, but
  reads `DEFAULT_EFFORT` and `apply_provider_env`

## How to extend

1. **New protocol message section** — add the constant to `templates.rs`,
   add a `prompt.push_str(NEW_PROTOCOL)` call in `assemble_prompt`'s
   Communication Protocols section. Never inline the string.
2. **New prompt variable** — register the magic name in `variables.rs`'s
   `trusted_vars` HashMap and document it in the module doc comment. Test
   that it survives sanitisation.
3. **New CLI flag** — add to `cli_args::build_cli_args_inner`. If it's
   provider-specific, add to `apply_provider_env` instead.
4. **New advisory template** — edit `advisory::ADVISORY_ASSISTANT_PROMPT`
   directly. The advisory prompt is a full replacement, not a merge.

## For future LLM CLIs reading this

1. **Don't break the structural defence.** Every XML boundary tag has a
   nonce; every variable goes through sanitisation. The canary
   instruction at the end of the prompt tells the LLM what to do if it
   sees a reinterpretation attempt. Don't remove any of these.
2. **The Communication Protocols section is the persona contract.** If
   you're reading this to debug why a persona isn't emitting
   `user_message` or `emit_event`, the contract is in `templates.rs`.
   Changes there immediately affect every persona execution.
3. **Tests live in `mod.rs::tests` (~1300 lines).** Most cover the full
   `assemble_prompt` output shape. Don't split them into per-submodule
   test blocks — the integration tests are load-bearing.
