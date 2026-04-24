# God-file refactor plan

This doc tracks the incremental refactor of 2000+ LOC Rust files in
`src-tauri/src/` into submodule directories with READMEs. The goal is DX: let
future contributors (human or LLM agent) open a directory README and
understand the module in < 5 minutes without scrolling through a 3000-line
file.

## Completed

### `engine/runner/` ✅

| File | LOC | Role |
|---|---|---|
| `mod.rs` | 1979 | `run_execution` orchestrator + tests |
| `env.rs` | 85 | `BLOCKED_ENV_NAMES`, `sanitize_env_name`, OAuth refresh locks |
| `globals.rs` | 64 | `apply_global_setting`, `resolve_global_provider_settings`, `default_result` |
| `credentials.rs` | 489 | `resolve_credential_env_vars` + `inject_*` + `try_refresh_oauth_token` |
| `README.md` | 115 | Module map, pipeline stages, invariants |

Verified: `cargo check` clean on both `test-automation desktop-full` and
default features.

## In progress (other branch)

### `engine/build_session/` 🚧

Being extracted from `build_session.rs` (3419 LOC) into submodules:
`gates.rs`, `prompt.rs`, `parser.rs`, `tool_tests.rs`, `templates.rs`,
`runner.rs`. Design doc in that directory's README.

## Planned (this doc)

### 1. `engine/prompt/` — target layout

```
engine/prompt/
├── mod.rs              # ResolvedConnectorHint + DisciplineMode + assemble_prompt (580 lines) + tests
├── capabilities.rs     # parse_model_profile, render_active_capabilities, active_capabilities_fingerprint, render_generation_policy_lines, build_tool_documentation
├── variables.rs        # replace_variables
├── runtime_safety.rs   # generate_runtime_nonce, wrap_runtime_xml_boundary, sanitize_runtime_variable, is_invisible_runtime_char, RUNTIME_CANARY_INSTRUCTION, DANGEROUS_TAGS, MAX_RUNTIME_VAR_LENGTH
├── cli_args.rs         # base_cli_setup, apply_provider_env, DEFAULT_EFFORT, resolve_effort, build_cli_args*, build_resume_cli_args*
├── resume_prompt.rs    # assemble_resume_prompt
├── advisory.rs         # build_advisory_prompt + ADVISORY_ASSISTANT_PROMPT
├── templates.rs        # MEMORY_SYSTEM_PREAMBLE, PROTOCOL_*, EXECUTION_MODE_DIRECTIVE, DELIBERATE_MODE_DIRECTIVE, PROTOCOL_INTEGRATION_REQUIREMENTS
└── README.md
```

**Line ranges (as of commit 4a1f8c76):**
- capabilities.rs: 19-234
- runtime_safety.rs: 845-991
- variables.rs: 992-1070
- cli_args.rs: 1071-1375
- resume_prompt.rs: 1376-1416
- templates.rs: 1418-1587 + 1908-2012
- advisory.rs: 1588-1907

**Visibility changes:**
- `pub fn`/`pub const` items stay `pub` and re-export at `prompt/mod.rs` via `pub use`
- Private `fn`/`const` become `pub(super)` where called from mod.rs
- `MEMORY_SYSTEM_PREAMBLE`, `PROTOCOL_*`, mode directives → `pub(super) const` in
  templates.rs, imported by mod.rs via explicit `use templates::{…};`
- `RUNTIME_CANARY_INSTRUCTION` → `pub(super) const` in runtime_safety.rs
- Runtime static `RUNTIME_NONCE_COUNTER` → `pub(super) static` in runtime_safety.rs

**Public API preservation** (external callers use these paths):
- `engine::prompt::assemble_prompt` — stays in mod.rs
- `engine::prompt::assemble_resume_prompt` — re-export from resume_prompt.rs
- `engine::prompt::build_cli_args`, `build_cli_args_with_trace`,
  `build_resume_cli_args`, `build_resume_cli_args_with_trace`,
  `apply_provider_env`, `DEFAULT_EFFORT` — re-export from cli_args.rs
- `engine::prompt::parse_model_profile`,
  `active_capabilities_fingerprint`, `render_active_capabilities`,
  `render_generation_policy_lines`, `build_tool_documentation` — re-export
  from capabilities.rs
- `engine::prompt::replace_variables` — re-export from variables.rs
- `engine::prompt::ResolvedConnectorHint` — stays in mod.rs

**Why deferred:** cannot verify the split in isolation while build_session's
in-flight state produces ~40 cascade errors across `engine/`. Will land
after build_session merges to master and the baseline is green again.

**Procedure (once unblocked):**
1. `python scripts/refactor/split_prompt.py` (to be written — see
   `docs/refactor/split-prompt-automation.md` sibling doc for the Python
   template)
2. `cargo check --features test-automation --no-default-features --features desktop-full` — expect 0 errors
3. `cargo check` (default features) — expect 0 errors
4. Write `engine/prompt/README.md` matching the `runner/README.md` shape
5. Commit; rebase onto master if build_session merged in the meantime

### 2. `engine/execution_engine/` — target layout

Extract the `ExecutionEngine` struct + 16 functions (~2900 lines) out of
`engine/mod.rs`, leaving mod.rs with just the 119 `pub mod` declarations
and `ENGINE_MAX_EXECUTION_*` constants.

```
engine/
├── mod.rs                    # ONLY module declarations + constants (~170 lines)
└── execution_engine/
    ├── mod.rs                # ExecutionEngine struct + public API + QueuedExecutionContext
    ├── queue.rs              # drain_and_start_next, queue management
    ├── persist.rs            # persist_status_if_running, persist_status_if_not_final
    ├── ceiling.rs            # run_execution_with_ceiling
    ├── result_handler.rs     # handle_execution_result
    ├── notify.rs             # notify_execution, notify_execution_rich
    ├── budget.rs             # check_budget_enforcement
    ├── healing.rs            # evaluate_healing_and_retry, spawn_healing_retry, spawn_healing_chain, spawn_delayed_retry
    ├── circuit_breaker.rs    # check_circuit_breaker
    ├── connector_matching.rs # find_matching_connector_names
    ├── knowledge.rs          # resolve_service_knowledge_hint, record_failure_to_knowledge_base
    └── README.md
```

**Why deferred:** engine/mod.rs holds the `pub mod build_session;`
declaration that the other branch is actively mutating; touching the same
file now would merge-conflict. Attempt only after build_session lands.

### 3. `commands/infrastructure/dev_tools/` — target layout

Split by section headers (`Projects`, `Active Project`, `Goals`, `Goal
Dependencies`, `Goal Signals`, `Sessions`, …) — 104 Tauri commands
organised by entity.

```
commands/infrastructure/dev_tools/
├── mod.rs          # re-exports for lib.rs command registration
├── projects.rs     # ~7 commands
├── goals.rs        # ~9 commands
├── goal_deps.rs    # 3 commands
├── goal_signals.rs # 3 commands
├── sessions.rs     # remaining commands
└── README.md
```

**Isolation:** this file has no cross-cutting state shared with the engine
namespace. Safe to land in parallel with build_session/runner/prompt
refactors.

### 4. `db/repos/dev_tools/` — mirror split of the commands

90 fns following the same entity boundaries. Pair this refactor with #3 in
the same PR so the command/repo pairs stay co-located.

### 5. `db/repos/communication/events/` — split by kind

32 fns split by operation class: write (insert/update/delete), query
(get/list/search), stream (subscribe/publish), maintenance
(cleanup/migrate).

### 6. `db/repos/resources/triggers/` — split by action

33 fns split by: register/unregister, fire/poll, query, maintenance.

### 7. `engine/db_query/` — split by query kind

35 fns; split by SELECT/INSERT/UPDATE/DELETE + prepared-statement cache
management.

### 8. `commands/core/data_portability/` — split by direction

24 fns; split into `import.rs` and `export.rs` with shared `shared.rs` for
serialisation helpers.

## Lessons learned (from runner + prompt + aborted events/data_portability passes)

### Safe patterns

- **Self-contained helper blocks**: the runner `env.rs` / `globals.rs` /
  `credentials.rs` and prompt `capabilities.rs` / `cli_args.rs` / `templates.rs`
  extractions worked because each block references only module-internal items
  via explicit imports. Identify these by grepping for cross-function
  references before cutting.
- **Explicit submodule imports**: every moved file needs a `use` block at the
  top that mirrors *only* what its functions reference. Don't copy the whole
  parent import list — it'll leave dangling imports that turn into warnings.
- **Visibility escalation**: private `fn foo()` called from another submodule
  becomes `pub(super) fn foo()`. The runner/prompt splits use this
  consistently; grep `pub(super)` in those modules for the pattern.

### Traps to avoid

- **`#[tauri::command]` functions cannot be freely moved.** The proc macro
  generates a sibling `__cmd__<name>` item at the module where the function
  is defined. `pub use submodule::cmd;` does NOT bring `__cmd__cmd` into the
  parent namespace, so `lib.rs`'s `tauri::generate_handler!` registration
  fails with "could not find `__cmd__cmd` in `<parent>`". **Rule:** keep
  every `#[tauri::command]` function in the top-level `mod.rs`. Only split
  the internal helpers they call.
- **Private helper dependency graphs are load-bearing.** `db/repos/events.rs`
  exposes ~32 `pub fn`s that all share ~5 private helpers (`row_to_event`,
  `row_to_subscription`, `collect_rows`, `encrypt_optional_payload`,
  `get_by_id`). Splitting *any* subset of the public functions into
  submodules requires promoting those helpers to `pub(super)` first, AND
  ensuring the new submodule imports them with the right path. Miss one and
  you get dozens of cascading "cannot find X in this scope" errors.
  **Rule:** before a repo split, grep every private helper the to-be-moved
  functions call, promote each to `pub(super)`, verify the split compiles,
  *then* add doc comments.
- **Nested types in `crate::db::models`**. Types like
  `CreatePersonaSubscriptionInput` live in separate sub-files under
  `db/models/`. A submodule that references them needs
  `crate::db::models::subscriptions::CreatePersonaSubscriptionInput`, not
  the re-exported top-level path — depending on how the models crate
  surfaces the types. Grep `use crate::db::models::` in the parent before
  writing submodule imports.
- **External callers on private-named helpers**. Commands outside the repo
  file sometimes call helpers you'd assume were private (e.g. a `search`
  function). Always grep the symbol across the whole tree before moving it.

### Aborted passes (this session)

- `commands/core/data_portability.rs` — reverted. 7 tauri::commands span the
  whole file, and competitive-parser helpers pull in the full crate's
  `db::repos::*` import tree. A viable split keeps all commands in
  `mod.rs` and only extracts the non-command helpers (`build_export_bundle`,
  `create_zip_bundle`, `validate_bundle`, competitive parsers, credential
  encryption). Plan: add the full top-of-file `use` block to each submodule
  header, make private helpers `pub(super)`, try again.
- `db/repos/communication/events.rs` — reverted. Subscriptions and
  dead-letter submodules lost access to `row_to_event`, `row_to_subscription`,
  `collect_rows`, `encrypt_optional_payload`, and nested model types. Plan:
  make all private helpers `pub(super)` in a prep commit first, verify no
  behavior change, *then* do the submodule extraction.

## Will NOT refactor

- `db/migrations/incremental.rs` (2166 LOC, 1 fn): linear by design — each
  migration is a numbered block, splitting loses chronological readability.
- `lib.rs` (2165 LOC, 5 fns): Tauri entry + command registration list.
  Standard Tauri shape, disruptive to split, low DX improvement.

## For future agents reading this

1. **Check `git status` first** — another branch may be mid-refactor on a
   god file. If `engine/foo.rs` is deleted and `engine/foo/` exists but
   `cargo check` produces unresolved-import errors in that directory, the
   other branch hasn't finished. Leave it alone.
2. **Verify on both feature sets** — this project has two compile paths:
   default features AND `test-automation desktop-full`. A refactor that
   passes one and fails the other is a regression.
3. **Preserve the public API** — every `pub fn` / `pub const` / `pub
   struct` at the top of a god file is likely called from 10+ other
   modules. Use `pub use` at the new `mod.rs` to keep the flat path
   (`engine::prompt::assemble_prompt`) unchanged.
4. **Write the README first** — if you can't explain the module boundary
   in a 10-line table, the boundary is wrong. Shake it out before you
   start moving code.
