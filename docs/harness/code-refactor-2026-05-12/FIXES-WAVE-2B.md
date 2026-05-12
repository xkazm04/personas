# Code-Refactor Fix Wave 2B — Repo-Layer CRUD Collapse (Personas + Executions)

> 3 atomic commits, 3 high-severity findings closed (D8, D2, D5).
> Baseline preserved: tsc 0 → 0, cargo check 0 → 0; cargo warnings unchanged at 133.
> **One real bug fixed (D8 drift)** + 2 schema-drift surfaces collapsed.
> D9 (lab command CRUD across 4 modes) deferred to Wave 2C — context budget for this session was best spent on D8 (active drift bug) and D2 (95 LOC saved in a hot path).

## Commits

| # | Commit       | Findings closed                                                | Lines (net) | Files                                                          |
|---|--------------|----------------------------------------------------------------|-------------|----------------------------------------------------------------|
| 1 | `1be8eceed`  | persona-crud-editor #1 (D8) — **drift bug fixed**              | +55 / –97   | `commands/core/personas.rs`                                    |
| 2 | `8fc39e9b9`  | execution-engine-healing-genome #1 (D2)                        | +44 / –139  | `db/repos/execution/executions.rs`                             |
| 3 | `429cb6c59`  | execution-engine-healing-genome #3 (D5)                        | +32 / –32   | `db/repos/execution/executions.rs`                             |

**Net diff: +131 / –268 = –137 LOC.** Plus the drift bug fix added two missing fields (`parameters`, `gatewayExposure`) to the cloud sync payload that should have been there all along.

## What was fixed

### 1. `spawn_persona_cloud_sync` — bug fix + 55-LOC collapse (D8)

`update_persona` and `update_persona_parameters` each spawned an identical fire-and-forget cloud-sync task with ~55 LOC of: lock cloud_client, list deployments, find matching persona_id, load tools, call `assemble_prompt`, build a 15-field json body, `upsert_persona`. They differed only in log messages.

**The drift bug** was concrete and shipping: neither block forwarded `parameters` or `gatewayExposure`, even though `Persona.parameters: Option<String>` and `Persona.gateway_exposure: PersonaGatewayExposure` are persisted server-side. Param-only updates left the cloud copy with stale parameter data; gateway_exposure changes never propagated upward.

Extracted `fn spawn_persona_cloud_sync(state: &Arc<AppState>, persona: Persona, reason: &'static str)`. Both update commands collapse to a single line that names the reason (`"after_update"` vs `"after_parameter_update"`) for tracing distinguishability. The consolidated body now includes both missing fields. **Bug fix and refactor in one commit.**

### 2. `update_status_with_guard` — 95-LOC collapse on schema-critical path (D2)

`update_status`, `update_status_if_running`, and `update_status_if_not_final` were three ~70-LOC near-identical functions in the executions repo. They differed only in:
- The WHERE-clause guard suffix (`""` / `" AND status = 'running'"` / `" AND status IN ('running', 'cancelled')"`)
- Return type (`Result<()>` vs `Result<bool>`)
- The `timed_query!` label

Each repeated the same 16-column COALESCE UPDATE, the same 17-element param tuple, and the same started_at/completed_at computation. Adding a column to `persona_executions` required updating three SQL strings and three param tuples in lockstep — a real silent-data-loss footgun (forgetting one variant would silently truncate that field on whichever CAS path got missed).

Extracted private `update_status_with_guard(pool, id, input, guard_sql, timed_label) -> Result<usize, AppError>`. SQL is built with `format!("WHERE id = ?12{}", guard_sql)` and `prepare_cached` on the resulting full SQL still works (each variant gets its own cache key, identical to before). The three public wrappers shrink to ~10-line orchestrators. **Column list now lives in ONE SQL string.**

### 3. `GlobalExecutionRow` mapper delegates to `row_to_execution` (D5)

`PersonaExecution` and `GlobalExecutionRow` are separate types (Global adds 3 JOIN columns: `persona_name`, `persona_icon`, `persona_color`), but their first 24 columns are identical — including the awkward Option-with-default unwraps for nullable columns (`input_tokens`, `output_tokens`, `cost_usd`, `log_truncated`, `business_outcome`). Both mappers spelled out the same 24 column reads.

Have the GlobalExecutionRow mapper call `row_to_execution(row)?` first to get the 24 shared columns into a `PersonaExecution` value, then `field: base.field` the values across and only hand-read the 3 JOIN-only columns. **Struct types remain unchanged** — the ts-rs binding shape on both sides stays stable. The win is invariant maintenance: nullable-column handling lives in one place, and new columns on `persona_executions` are added once to `row_to_execution` rather than threading through two mappers in lockstep.

The LOC diff is 0 (32 in / 32 out) but the change is semantic, not cosmetic — schema drift between the two mappers becomes structurally impossible.

## Verification table (before / after this wave)

| Metric                       | Before Wave 2B | After Wave 2B | Delta |
|------------------------------|---------------:|--------------:|-------|
| `tsc --noEmit` errors        | 0              | 0             | ✓     |
| `cargo check` errors         | 0              | 0             | ✓     |
| `cargo check` warnings       | 133            | 133           | unchanged |
| `npm run lint` errors        | 0              | 0             | ✓     |

Cumulative since Phase B2 baseline: all gates green.

## Cumulative status (Waves 1A + 1B + 2A + 2B)

| Wave   | Theme                                              | Highs closed | LOC removed (net) | Commits |
|--------|----------------------------------------------------|-------------:|------------------:|--------:|
| 1A     | Whole-module orphan deletion                       | 7 of 15      | ~6,950            | 7 (+1 docs) |
| 1B     | Remaining Theme-A orphans                          | 8 of 8       | ~2,534            | 6 (+1 docs) |
| 2A     | Repo/DB CRUD collapse (vault + recipes)            | 5 of 9       | ~51 (14 sites collapsed onto 5 helpers) | 5 (+1 docs) |
| 2B     | Repo/DB CRUD collapse (personas + executions)      | 3 of 4 in 2-batch | ~137 + drift bug fixed | 3       |
| **Σ**  | **Theme A complete + Theme D 8/9** | **23 of 24** highs across A+D | **~9,672** | **24** code + 3 doc |

## D9 — deferred to Wave 2C

The remaining Theme D finding is `lab.rs` command CRUD duplicated across 4 modes. The scan suggests collapsing the 4 mode-specific commands into a generic dispatcher. The scope warrants its own session because:
- Each lab mode has slightly different validation invariants that need to survive the collapse.
- 4 Tauri command surfaces are involved (frontend invokers will continue to work as-is — but the dispatcher pattern is large enough that a careful read is required).

Flagged for the next session. Pattern would be similar to D6's `cancel_ai_artifact_task` extraction but with a per-mode trait/enum to encode the validation differences.

## Patterns established (catalogue items 11–13)

11. **Drift bugs and dedup commits can ride together when the consolidated body includes the "missing" fields.** D8 was both "two near-identical blocks of code" AND "a real bug because both blocks dropped two persisted fields." The fix is the same commit: extract the helper, and have the helper include the fields that should have been there. The commit becomes `fix(...)` instead of `refactor(...)` and the bug fix is clearly attributable to the dedup.

12. **`format!`-built SQL is fine with `prepare_cached` — each variant becomes its own cache key.** When you have N near-identical SQL statements that differ only in a WHERE-clause suffix, building the SQL string at runtime via `format!` and passing it to `prepare_cached(&sql)` produces N cached statements (one per variant string), behaviourally identical to N separate `prepare_cached("literal")` calls. No performance regression.

13. **`field: base.field` value-copy from a delegate-built struct is shorter than `field: row.get("col")?` from a raw row.** When two structs share most columns and the column reads have nullability-handling boilerplate, having one mapper delegate to another and then copy via struct fields is cheaper than copying the verbose `row.get` lines. Field types match by construction (Rust enforces it), so there's no risk of a typo silently changing semantics.

## What remains in the scan

- **D9** (lab command CRUD ×4 modes) — last Theme D finding, deferred.
- **Themes B, C, E, F, G, H, I, J, K** — untouched. See INDEX.md.
- **Recommended next session focus**: Theme G's correctness bug (`DriveStatus.storageUsedBytes: bigint` vs `number` truncating drives >9 PB) — one-line hotfix.
- Then Theme E (UI presentation duplication, 11 highs) or Theme B+C (backend dead-code + broken wrappers, 9 highs).
