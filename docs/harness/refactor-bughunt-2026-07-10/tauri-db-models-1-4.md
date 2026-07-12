> Context: tauri:db/models [1/4]
> Total: 8
> Critical: 0  High: 1  Medium: 3  Low: 4

## 1. `parse_design_context` silently drops `dev_project_id` / `connector_pipeline` / `archetype_id` / `memory_strategy_id`

- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure / data-loss
- **File**: src-tauri/src/db/models/persona.rs:642-715 (new-format guard at 649-659)
- **Scenario**: A persona's `design_context` JSON is parsed by `parse_design_context`. It first deserializes into a `DesignContextData` (which succeeds and correctly populates `dev_project_id`), but the "is this the new format?" check only tests `design_files || credential_links || use_cases || summary || twin_id`. If the envelope carries ONLY `dev_project_id` (the codebase pin — set for every team-adopted member per the field's own doc at 434-443) and none of those five, the fully-parsed struct is discarded and control falls through to the legacy branch, which rebuilds a fresh `DesignContextData::default()` and never reads `dev_project_id`, `connector_pipeline`, `archetype_id`, or `memory_strategy_id`. Those fields come back `None`.
- **Root cause**: The new-format sentinel list was not extended when `twin_id`, `dev_project_id`, `archetype_id`, `memory_strategy_id`, and `connector_pipeline` were added — only `twin_id` was patched in.
- **Impact**: The `codebase` connector resolves `parsed_design_context().dev_project_id`; when it's silently lost the persona falls back to the globally-first project and reads the WRONG repository. Any write path that reads-then-reserializes the envelope permanently strips these bindings. Data loss + capability mis-scoping.
- **Fix sketch**: Add the missing fields to the guard (or better: treat a successful `DesignContextData` parse of a JSON object as authoritative and only use the legacy path when structured parse fails). E.g. `|| data.dev_project_id.is_some() || data.connector_pipeline.is_some() || data.archetype_id.is_some() || data.memory_strategy_id.is_some()`.

## 2. `ActiveWindow::is_active_at` reports overnight windows inactive after midnight

- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / clock
- **File**: src-tauri/src/db/models/trigger.rs:164-199
- **Scenario**: Window configured `days=[Mon]`, `start_hour=22`, `end_hour=6` (overnight). At Monday 23:00 the weekday check passes and the overnight minute test (`now >= start || now < end`) returns active — correct. At Tuesday 02:00, the window opened Monday is logically still active, but the function computes `weekday = Tuesday`, which is NOT in `days=[Mon]`, so it returns `false` at line 187 before the overnight minute logic ever runs.
- **Root cause**: The `days` membership test is evaluated against the *current* calendar day, but an overnight window's active span belongs to the day it *opened*. The minute math handles overnight roll-over; the day filter does not.
- **Impact**: Triggers with an overnight active window stop firing between midnight and `end_hour` on the intended night — a silent scheduling gap (the persona looks configured but is dormant during part of its own window).
- **Fix sketch**: When `start_minutes > end_minutes` and `now_minutes < end_minutes`, test membership of the *previous* day `(weekday + 6) % 7` against `days` instead of (or in addition to) the current day.

## 3. `increment_refresh_backoff` panics on an empty `backoff_steps` slice

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case / crash
- **File**: src-tauri/src/db/models/credential_ledger.rs:207-211
- **Scenario**: `step_idx = (fail_count as usize).min(backoff_steps.len() - 1)`. If a caller ever passes an empty `backoff_steps`, `backoff_steps.len() - 1` underflows `usize` to `usize::MAX`, then `backoff_steps[step_idx]` panics with an out-of-bounds index.
- **Root cause**: `len() - 1` assumes a non-empty slice with no guard.
- **Impact**: A panic on the OAuth refresh path if the backoff schedule is ever misconfigured/empty. Today's callers pass a const so it's latent, but it's an unguarded invariant.
- **Fix sketch**: `if backoff_steps.is_empty() { return (self.oauth_refresh_fail_count.unwrap_or(0)+1, 0); }` or `let step_idx = fail_count.min(backoff_steps.len().saturating_sub(1))` combined with an early return for empty.

## 4. `row_to_lab_result_base` swallows `eval_method` column errors via `unwrap_or(None)`

- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src-tauri/src/db/models/lab.rs:145
- **Scenario**: Every other field in this row-mapper propagates errors with `?`, but `eval_method: row.get("eval_method").unwrap_or(None)` converts ANY `rusqlite` error (missing column, type mismatch) into `None`, masking real schema drift as "no eval method".
- **Root cause**: Likely an intentional tolerance for older rows lacking the column, but it's implemented as a blanket error swallow rather than a targeted default.
- **Impact**: A genuine schema/type problem on this column is invisible; the row loads with a wrong `eval_method`. Maintainability + honesty.
- **Fix sketch**: Use `row.get::<_, Option<String>>("eval_method")?` so only NULLs become `None` and real errors surface; or document the deliberate swallow inline.

## 5. `dev_tools.rs` is an 874-line grab-bag module spanning ~8 unrelated domains

- **Lens**: code-refactor
- **Severity**: medium
- **Category**: oversized-module
- **File**: src-tauri/src/db/models/dev_tools.rs:1-874
- **Scenario**: The file holds ~40 struct/enum definitions for projects, goals + dependencies + signals + items, use-cases, KPIs (+ bindings + measurements), context groups/contexts, ideas + scans + standards, tasks, competitions, portfolio/attention rollups, tech-radar/risk-matrix, and health snapshots — logically distinct subsystems that only share the `dev_*` prefix.
- **Root cause**: Accretion — every new Dev Tools surface appended its rows here rather than a focused submodule.
- **Impact**: High cognitive load, merge-conflict magnet, hard to locate a type. Maintainability.
- **Fix sketch**: Split into `db/models/dev_tools/{projects,goals,kpi,context,ideas,portfolio,health}.rs` re-exported from a `mod.rs`; pure move, no behavior change.

## 6. `GlobalExecutionRow` duplicates `PersonaExecution` field-by-field (and its comment block verbatim)

- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/db/models/execution.rs:11-84 vs 134-186
- **Scenario**: `GlobalExecutionRow` re-declares ~28 of `PersonaExecution`'s fields identically and appends only `persona_name/icon/color`. The multi-line ts-rs `execution_flows` justification comment is copy-pasted verbatim into both (lines 22-28 and 146-152). The two shapes drift silently (e.g. `GlobalExecutionRow` lacks `cache_read_tokens`, `director_score`) with no compiler help keeping them aligned.
- **Root cause**: A JOIN-augmented projection was authored by cloning the base struct rather than composing it.
- **Impact**: Every new execution column must be added in two places or the global view silently omits it. Maintainability.
- **Fix sketch**: Give `GlobalExecutionRow` a `#[serde(flatten)] base: PersonaExecution` (or a shared `ExecutionCore`) plus the three persona-metadata fields, so additions propagate and the duplicated comment lives once.

## 7. `ConnectorWithCount` and `CategoryWithCount` are byte-identical structs

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/models/review.rs:197-207
- **Scenario**: Both structs are `{ name: String, count: i64 }` with identical derives; the only difference is the type name.
- **Root cause**: Two callers each minted their own count row.
- **Impact**: Trivial redundancy; two names for one shape. Maintainability.
- **Fix sketch**: Collapse to a single `NameWithCount` (or type aliases) unless a distinct wire name is deliberately required for ts-rs export.

## 8. `execution_flows` ts-rs workaround comment is duplicated verbatim across two structs

- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/models/execution.rs:22-28 and 146-152
- **Scenario**: The identical 7-line explanation of the ts-rs nested-import limitation is pasted above the `execution_flows` field in both `PersonaExecution` and `GlobalExecutionRow`.
- **Root cause**: Same copy-paste origin as finding 6.
- **Impact**: Doc drift risk (a fix note updated in one copy only). Cosmetic maintainability.
- **Fix sketch**: Resolves naturally if finding 6's shared-base refactor lands; otherwise reference a single doc comment on a shared type alias for the field.
