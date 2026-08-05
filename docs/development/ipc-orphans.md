# IPC orphan commands — census and disposition

**Status:** report only. **Nothing in this document has been deleted.** Backend
deletion is a separate, future decision; this is the evidence it would rest on.

**Measured:** 2026-07-26, on `worktree-agent-a30784a8896c2dfee` (merged from
`architect-integration`). Supersedes the "182 backend commands without an
`api/` wrapper" figure recorded by the 2026-05-10 `/architect` ipc-boundary
scan — that number counted *missing wrappers*, not *unreachable commands*, and
conflated the two.

Established by [[Architect/decisions/2026-05-10-orphan-commands-wrap]]. The
frontend half of that ADR (route every direct `invokeWithTimeout` through
`src/api/**`) is complete as of this pass; see
[§ Frontend routing status](#frontend-routing-status).

---

## Method

1. Parse the single `tauri::generate_handler!` block in `src-tauri/src/lib.rs`
   (lines 1697–3516, wrapped by `ipc_auth::wrap_invoke_handler`). There are no
   helper macros and no second block. 46 entries carry `#[cfg(...)]` gates
   (`desktop`, `p2p`, `ml`, `debug_assertions`, `test-automation`).
   **Zero** commands use `rename_all` / `name =`, so the Rust fn name is the
   IPC command name throughout.
2. Search all of `src/**` (excluding the generated
   `src/lib/commandNames.generated.ts`) for each command-name string.
3. For every unreferenced command, search the non-IPC surfaces:
   `engine/management_api.rs`, `mcp_server/**`,
   `companion/orchestration/mcp/**`, `commands/companion/mcp_bridge.rs`,
   `engine/a2a/**`, `test_automation.rs`, and every Rust test file — plus a bare
   fn-name grep across all of `src-tauri/src`.
4. Date each orphan's introducing commit
   (`git log --diff-filter=A -1 -- <file>`) to separate "abandoned" from
   "not wired up yet".

## Totals

| | count |
|---|---|
| Registered IPC commands | **1,519** (no duplicates) |
| Referenced somewhere in `src/**` | 1,410 |
| — production code | 1,405 |
| — test-only reference | 5 |
| **Unreferenced** | **109** (7.2 %) |
| → (a) truly dead | **29** |
| → (b) reachable via a non-IPC surface | **0** |
| → (c) plausibly upcoming / seeded | **80** |

The five test-only references are `__test_respond`,
`export_selective_to_path`, `import_portability_bundle_from_path`,
`get_policy_events_for_execution`, `synthesize_manual_review`. They have a real
caller (the test harness), so they are not orphans — but they are also not
reachable from the product UI, which is worth knowing before anyone "cleans up"
a test.

## The headline finding: class (b) is empty

**No orphan command is kept alive by the HTTP / MCP / A2A surfaces.** This was
the main open question and the answer is unambiguous. Every hit when grepping
the 109 orphan names across those surfaces was either a doc-comment mention, or
a *same-named but different* function in `db/repos/**` / `engine/**` that the
IPC command also delegates to.

The alternate surfaces do not call command functions — **they reimplement the
handler locally**:

- `engine/management_api.rs` has its own `list_personas` / `build_status` that
  call `db::repos::core::*` directly.
- `mcp_server/vault.rs` explicitly documents that it reimplements rather than
  reusing `commands::obsidian_brain::graph`.
- `start_build_session_headless` — which *reads* as purpose-built for the HTTP
  path — is named only in comments (`test_automation.rs:949`,
  `approval_exec_core.rs:732,791`). management_api's `/api/build` calls
  `build_session_manager.start_session()` directly.

**Consequence for a future deletion pass:** you do not need to audit
management_api / MCP / A2A before removing a class-(a) command. You *do* need to
treat the duplication itself as its own finding — three surfaces each carrying
their own copy of "list personas" is a drift generator independent of the orphan
question.

---

## (a) Truly dead — 29

No caller anywhere: no frontend, no HTTP/MCP/A2A, no Rust test, no other Rust
code path.

| command(s) | file | disposition |
|---|---|---|
| `get_startup_timing` | `lib.rs` | Diagnostic never read; siblings `log_frontend_error` / `report_frontend_ready` are used. **Delete.** |
| `get_validation_rules`, `validate_persona_contracts` | `commands/core/validation.rs` | Whole module 0/2 used. `engine::capability_contract::validate_persona_contracts` is called internally by `runner` / `dry_run`, so the logic stays — only the IPC wrappers are dead. **Delete the wrappers, keep the engine fn.** |
| `create_execution` | `commands/execution/executions.rs` | Superseded — the frontend creates runs via `execute_persona`. **Delete.** |
| `get_run_budget_state`, `list_run_budgets` | `commands/execution/evolution.rs` | Run-budget UI never shipped (added 2026-03-19). **Delete, or file the UI as backlog and keep.** |
| `list_trigger_chains` | `commands/tools/triggers.rs` | Chain listing never surfaced; all 29 sibling trigger commands are used. **Delete.** |
| `list_n8n_sessions` | `commands/design/n8n_sessions.rs` | Superseded by `list_n8n_session_summaries` (used). **Delete.** |
| `openapi_parse_from_url`, `openapi_parse_from_content`, `openapi_generate_connector`, `openapi_playground_test` | `commands/credentials/openapi_autopilot.rs` | Entire module 0/4 used since 2026-03-27; the frontend `ApiExplorerTab` uses different commands. **Largest single dead *feature*.** |
| `ocr_with_gemini`, `ocr_with_claude`, `list_ocr_documents`, `get_ocr_document`, `delete_ocr_document` | `commands/ocr/mod.rs` | Superseded by `ocr_drive_file_gemini` / `ocr_drive_file_claude` / `cancel_ocr_operation` under `commands/drive` (what `src/api/drive.ts` actually calls). **Decide one way: delete the module, or migrate the frontend onto it.** |
| `get_recipe_eligibility`, `get_recipe_catalog_for_persona` | `commands/recipes/recipe_eligibility.rs` | The frontend reimplements eligibility client-side (`src/features/templates/sub_recipes/eligibility.ts`, `useEligibility.ts`). **Duplicated logic — reconcile before deleting.** |
| `adopt_recipe_for_persona`, `unadopt_recipe_from_persona` | `commands/recipes/recipe_adoption.rs` | Same shape: the shipped adoption path (`RecipeAdoptionModal` → `useAdoption`) never invokes these. **Two implementations of adoption exist; one should go.** |
| `dev_tools_create_pipeline`, `dev_tools_list_pipelines`, `dev_tools_get_pipeline`, `dev_tools_advance_pipeline`, `dev_tools_delete_pipeline` | `commands/infrastructure/dev_tools.rs` | The dev-tools "pipeline" sub-feature is 0/5 used. (The *used* `*_pipeline_*` commands are the unrelated execution-pipeline namespace — don't confuse them.) **Delete the sub-feature.** |
| `dev_tools_list_health_snapshots`, `dev_tools_save_health_snapshot` | `commands/infrastructure/dev_tools.rs` | 0/2 sub-feature; `dev_tools_get_portfolio_health` covers the shipped need. **Delete.** |
| `dev_tools_attention_queue` | `commands/infrastructure/dev_tools.rs` | No sibling, no consumer. **Delete.** |

Four of these are **whole modules with zero frontend usage** and are the
highest-signal cleanup candidates: `credentials/openapi_autopilot.rs`,
`core/validation.rs`, `recipes/recipe_adoption.rs`,
`recipes/recipe_eligibility.rs`.

---

## (b) Reachable via a non-IPC surface — 0

See [the headline finding](#the-headline-finding-class-b-is-empty). Keep the
class in this document: the next census should re-check it rather than assume
it, because the *reason* it is empty (surfaces reimplement instead of reuse) is
a choice that could change.

---

## (c) Plausibly upcoming / seeded — 80

Grouped by *why* absence of a frontend caller is expected. **Do not delete on
orphan-status alone in this class** — the disposition column says what evidence
would change the call.

### c1. Feature-gated pre-wiring (`#[cfg]`) — 24

Compiled out of the default build, so a missing frontend caller proves nothing.
**Keep all.** A deletion pass must build with the gate enabled before judging
any of these.

| commands | file | gate |
|---|---|---|
| `discover_desktop_clis`, `get_pending_desktop_capabilities`, `revoke_desktop_approvals`, `is_desktop_connector_approved` | `commands/credentials/desktop.rs` | `desktop` — also explicitly allowlisted at `ipc_auth.rs:239` |
| `execute_desktop_bridge`, `execute_desktop_plan`, `get_desktop_runtime_status`, `get_desktop_plan_result` | `commands/credentials/desktop_bridges.rs` | `desktop` — bridge-execution half of the same cluster |
| `bridge_manifest_list_all`, `bridge_manifest_describe`, `bridge_manifest_dispatch` | `commands/infrastructure/bridge_manifest.rs` | `desktop`; added 2026-05-09, `BridgeManifestSummary` binding already generated |
| `get_connection_status`, `get_connection_health`, `send_agent_message`, `get_received_messages`, `set_network_config` | `commands/network/discovery.rs` | `p2p`; 8 siblings used |
| `get_device_group_id`, `list_owned_devices`, `register_owned_device`, `forget_owned_device` | `commands/network/owned_devices.rs` | `p2p`; added 2026-05-24, `OwnedDevice` binding exists |
| `get_exposure_manifest`, `get_resource_provenance` | `commands/network/exposure.rs` | `p2p` |
| `verify_bundle`, `resolve_share_deep_link` | `commands/network/bundle.rs` | `p2p`; 9 siblings used |
| `reinitialize_identity` | `commands/network/identity.rs` | `p2p`; recovery path documented at `engine/identity.rs:256` |
| `search_kb_for_clipboard_error` | `commands/execution/clipboard_intel.rs` | `all(desktop, ml)` |
| `companion_test_fleet_dispatch` | `commands/companion/mcp_bridge.rs` | `test-automation` diagnostic hook |

### c2. Recent modules with used siblings — 13

Added 2026-05 or later, in a cluster under active development. **Keep; re-check
at the next census** — if any is still orphaned in three months with no commits
to its module, it has become class (a).

| commands | file | evidence |
|---|---|---|
| `dev_tools_workspace_cancel_verify` | `commands/infrastructure/workspace_verify.rs` | added **2026-07-25** (one day before this census), 2 siblings used |
| `dev_checkpoint_stage`, `dev_fork_from_checkpoint`, `dev_rollback_to_checkpoint`, `dev_list_run_checkpoints` | `commands/infrastructure/git_checkpoint.rs` | added 2026-06-16; `engine/git_checkpoint.rs` had uncommitted edits in the tree at census time |
| `enqueue_persona_memory_curation`, `list_persona_jobs`, `get_persona_job`, `cancel_persona_job` | `commands/core/persona_jobs.rs` | added 2026-05-10, 4 siblings used, referenced from `memories.rs:322` doc — job-queue UI pending |
| `connector_explorer_explore` | `commands/design/connector_explorer.rs` | added 2026-05-09; `engine/connector_explorer/mod.rs` modified in tree |
| `list_recipe_suggestion_events` | `commands/recipes/recipe_suggestion_log.rs` | added 2026-05-09; its 2 siblings are now wrapped in `src/api/recipes/recipes.ts` |
| `companion_prune_low_value_facts`, `companion_enqueue_curation_run`, `companion_discard_consolidation_run` | `commands/companion/consolidate.rs` | added 2026-05-01, **13** siblings used |
| `companion_extract_fleet_patterns` | `commands/companion/fleet_bridge.rs` | added 2026-05-17 |
| `dev_tools_compute_scan_delta` | `commands/infrastructure/incremental_scan.rs` | added 2026-05-02; 22 scan siblings used |

### c3. Paired CRUD / read siblings of a heavily-used family — 41

Standard get/update/delete completion around a live feature. Low risk to keep,
cheap to delete if the project wants zero orphans — but each deletion removes a
capability a future panel would otherwise just call.

- `dev_tools_get_task`, `dev_tools_update_task`, `dev_tools_delete_task` — `dev_tools.rs` (list/create/execute/cancel all used)
- `dev_tools_create_scan`, `dev_tools_update_scan` — `dev_tools.rs` (22 scan siblings used)
- `dev_tools_get_goal`, `dev_tools_create_goal_signal` — `dev_tools.rs` (30 goal siblings used)
- `dev_tools_get_context`, `dev_tools_move_context_to_group` — `dev_tools.rs` (25 context siblings used)
- `dev_tools_portfolio_summary` — `dev_tools.rs`
- `get_exposed_resource`, `update_exposed_resource` — `commands/network/exposure.rs`
- `get_document_signature` — `commands/signing/mod.rs`
- `get_n8n_payload_limits` — `commands/design/n8n_limits.rs` (18 n8n siblings used)
- `get_use_case_recipes` — `commands/recipes/crud.rs` (20 siblings used)
- `list_recipes_by_template` — `commands/recipes/recipe_derivation.rs`
- `reset_build_session_phase`, `list_pending_build_questions`, `get_build_status`, `start_build_session_headless` — `commands/design/build_sessions.rs`. `get_build_status` is the *documented* polling counterpart to the event stream (`build_sessions.rs:156,183`) and `start_build_session_headless` the documented no-Channel variant; both look like intended-but-unwired API for the headless / approval paths. **Highest-value sub-group to either wire up or explicitly retire.**
- `build_kb_index` — `commands/execution/knowledge.rs`
- `get_template_manifest_count` — `commands/design/template_adopt.rs`
- `list_healing_knowledge`, `trigger_ai_healing` — `commands/execution/healing.rs` (manual-trigger + knowledge-list of a live feature)
- `initialize_event_handlers_for_persona` — `commands/tools/triggers.rs` (repo fn exercised by inline tests at `db/repos/resources/triggers.rs:2710`)
- `compile_workflow` — `commands/teams/teams.rs` (25 siblings used)
- `companion_post_team_message` — `commands/teams/team_channel.rs` (shared path documented at `companion/athena_reaction.rs:25`)
- `github_create_patch_release` — `commands/tools/github_platform.rs`
- `obsidian_brain_semantic_lint_vault` — `commands/obsidian_brain/mod.rs` (21 siblings used)
- `companion_review_recent_executions_now` — `commands/companion/chat.rs` (manual "run now")
- ~~`companion_request_improvement` — `commands/companion/feedback.rs`~~ **RESOLVED 2026-08-05 (retired):** the wrench-send self-improve pipeline it fronted was superseded by dev mode. The command was deregistered in `5e9835476`; `companion/dev_session.rs` and the `companion_init` orphan-recovery sweep were deleted outright in the follow-up.
- `companion_purge_sensory_source` — `commands/companion/sensory.rs` (`desktop`-gated, 5 siblings used)
- `refresh_session` — `commands/infrastructure/auth.rs`
- `cloud_webhook_relay_status` — `commands/infrastructure/cloud.rs` (36 siblings used; allowlisted at `ipc_auth.rs:696`)
- `run_memory_lifecycle` — `commands/core/memories.rs` (manual maintenance entry point)

### c4. Deliberate dev/test seeders — 2

`seed_mock_memory` (`commands/core/memories.rs`) and
`seed_linked_message_and_review` (`commands/design/reviews.rs`).
**Recommendation:** gate both behind `debug_assertions`, matching the two
seeders that already are. That converts them from orphans into c1, and removes
them from release builds — a small attack-surface win.

---

## Where the orphans concentrate

| orphans | file | siblings used |
|---|---|---|
| **18** | `commands/infrastructure/dev_tools.rs` | 113 — by far the largest command surface. 8 of the 18 are three dead sub-features (pipelines, health snapshots, attention queue); the other 10 are CRUD gaps. |
| 5 | `commands/ocr/mod.rs` | 3 — **whole module superseded** by `commands/drive` OCR |
| 5 | `commands/network/discovery.rs` | 8 — all `p2p`-gated |
| 4 | `commands/credentials/openapi_autopilot.rs` | **0** |
| 4 | `commands/infrastructure/git_checkpoint.rs` | **0** |
| 4 | `commands/network/owned_devices.rs` | **0** |
| 4 | `commands/credentials/desktop_bridges.rs` | **0** |
| 4 | `commands/core/persona_jobs.rs` | 4 |
| 4 | `commands/design/build_sessions.rs` | 11 |
| 4 | `commands/credentials/desktop.rs` | 5 |
| 4 | `commands/network/exposure.rs` | 4 |
| 3 | `commands/infrastructure/bridge_manifest.rs` | **0** |
| 3 | `commands/companion/consolidate.rs` | 13 |

`dev_tools.rs` alone is 17 % of the orphan set. If exactly one cleanup lands
from this document, it should be that file's three dead sub-features.

---

## Frontend routing status

The other half of the ADR. As of 2026-07-26 the only files outside
`src/api/**` that import `invokeWithTimeout` are:

| file | status |
|---|---|
| `src/stores/authStore.ts` | **canonical exception** — auth bootstraps before the `api/` layer is wired |
| `src/lib/utils/tauri/safeInvoke.ts` | **canonical exception** — IPC infrastructure helper consumed *by* `src/api/**`, not a call site |
| `src/features/plugins/twin/sub_brain/useBrainConnection.ts` | **blocked residual** — entangled with the snake_case binding migration; wrap it in the same change that resolves that |
| `src/test/automation/bridge.ts` | test harness (imports raw `invoke`; not production code) |

Everything else routes through a typed wrapper. Down from 17 files at the
2026-05-10 scan and ~22 at the start of this pass.

Five latent bugs were caught purely by *giving the payload a type* — which is
the argument for the policy, not a side benefit:

1. `listBuildSessions()` was annotated `BuildSessionSummary[]`; Rust returns
   `Vec<PersistedBuildSession>`. The wrapper had zero callers because
   `buildSessionBootstrap.ts` had bypassed it with a comment explaining the
   mismatch instead of fixing it.
2. `getScanCodebaseStatus()` declared `error` and `lines` non-optional; the Rust
   `not_found` branch omits both, so `result.lines.length` would throw on the
   exact path the poller exists to handle.
3. Routing the two scan pollers through the corrected wrapper produced 4 TS
   errors: `job.error` is `Option<String>` → arrives as `null`, but both
   `finalizeContextScan` and `finalizeScan` take `errorMessage?: string`. The
   old inline types said `error?: string`, hiding the null.
4. `useHealthCheck.ts` hand-declared `interface ConfigWarning` even though ts-rs
   already generates `src/lib/bindings/ConfigWarning.ts` from the same Rust
   struct. The copy happened to match; nothing kept it in sync.
5. Same pattern for `SurfaceStats`/`WakeStats` (WakeCadence), `LatestBuildSession`
   (UseCasesRefineCard), and `BackendIntegrityResult` (templateCatalog) — three
   more hand-rolled duplicates of shapes the backend already defines.

The general lesson matches the 2026-05-10 `'dismissed'` finding: **a direct
`invoke` call site is where a payload contract goes to die quietly.** Every one
of the five above was invisible at the call site and free to find once a wrapper
had to name the type.

---

## Next census

Re-run the method above. The three things to check first:

1. Is class (b) still empty, or did management_api / MCP start calling command
   functions?
2. Did any c2 (recent-module) orphan stay orphaned with no commits to its
   module? Those have aged into class (a).
3. Did `dev_tools.rs` grow more orphans? It is the file where this problem
   compounds fastest.
