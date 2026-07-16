# Research Lab — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Clearing a nullable project field is a silent no-op — the "disconnect vault" button doesn't disconnect
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/repos/research_lab.rs:88-99 (trigger UI: src/features/plugins/research-lab/sub_projects/ResearchProjectForm.tsx:44-50, 126-129)
- **Scenario**: User edits a project, clicks the X next to the Obsidian vault path (`setObsidianVaultPath('')`), and saves. The form sends `obsidianVaultPath: null` (`obsidianVaultPath.trim() || null`). In Rust, `UpdateResearchProject` fields are single `Option<T>`, and `update_project` does `input.obsidian_vault_path.as_ref().or(existing.obsidian_vault_path.as_ref())` — `None` falls back to the old value. Same for description/thesis/domain/team_id, and the same pattern exists in `update_hypothesis` (evidence fields can never be cleared).
- **Root cause**: The update API conflates "field not provided" with "field explicitly cleared to NULL" — a single `Option` can't express both, and the repo resolves `None` as "keep existing".
- **Impact**: Save reports success, modal closes, refetch still shows "Vault connected"; Obsidian sync keeps writing markdown into a vault the user explicitly disconnected. Any cleared description/thesis silently resurrects. Classic success theater on a first-class UI affordance.
- **Fix sketch**: Since the frontend always sends the full form snapshot, treat `None` as NULL for nullable fields (drop the `.or(existing…)` fallback for them), or move to a double-`Option`/`serde(default)`+`skip_serializing_if` "undefined vs null" encoding. Apply the same to `update_hypothesis`.

## 2. update_project is a non-transactional read-modify-write — concurrent updates silently revert each other
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/research_lab.rs:80-102
- **Scenario**: While the edit modal is saving name/thesis, another surface (e.g. a status advance from the dashboard/projects list, or a second window) calls `update_project` for the same project. Each call does `get_project` on one pooled connection, then an unconditional 8-column `UPDATE` on another, filling unspecified fields from its stale snapshot — the loser rewrites every column, clobbering the winner's committed change (a status change reverts, or vice versa).
- **Root cause**: Read (snapshot) and write happen on independent pool connections with no `BEGIN IMMEDIATE`, and the UPDATE writes all columns. This is exactly the race class already fixed in this same file for `create_source` and `create_experiment_run` (both use `transaction_with_behavior(Immediate)`), but `update_project` was left out.
- **Impact**: Lost updates: a field the user just set flips back to its prior value with no error — state corruption that looks like "the app forgot my change".
- **Fix sketch**: Wrap the `get_project` snapshot + `UPDATE` in one `BEGIN IMMEDIATE` transaction (mirror `create_source`), or better, build a dynamic `SET` clause containing only provided fields (as `update_hypothesis` already does).

## 3. get_project maps every DB error to NotFound; list functions silently drop unreadable rows
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/research_lab.rs:63 (also 38, 142, 327, 432, 494, 552, 674)
- **Scenario**: The SQLite file is momentarily busy/locked (e.g. Obsidian sync or a scan holds a write) when the user opens or saves a project. `get_project`'s `.map_err(|_| AppError::NotFound(...))` converts the busy/pool error into "Research project {id} not found" — and since `update_project` calls `get_project` first, a save against an existing project fails with a bogus "not found". Separately, every `list_*` uses `rows.filter_map(|r| r.ok())`, so any row that fails column mapping just vanishes from the list while `get_dashboard_stats` (raw `COUNT(*)`) still counts it.
- **Root cause**: Error shadowing — all error variants are collapsed into the one "expected" variant; row-mapping errors are treated as skippable instead of surfaced.
- **Impact**: Misleading diagnostics (transient lock reads as permanent data loss, users may recreate "missing" projects → duplicates) and dashboards that disagree with lists with no error anywhere.
- **Fix sketch**: Only map `QueryReturnedNoRows` to `NotFound` and pass other rusqlite errors through as `AppError::from(e)`; replace `filter_map(|r| r.ok())` with `collect::<Result<Vec<_>,_>>()?` (or at least log dropped rows).

## 4. Form modal can be dismissed mid-save — in-flight create lands invisibly, inviting duplicate retries
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/research-lab/shared/ResearchLabFormModal.tsx:38-45, 53-58
- **Scenario**: User submits (button correctly disables via `disabled={submitDisabled || saving}`), then — seeing only the generic `t.common.loading` label — clicks the X or Cancel, both of which stay enabled while `saving` is true (BaseModal's onClose paths too). The Tauri invoke keeps running: if it succeeds, the entity appears without the user knowing; if the user assumed nothing happened and reopens the modal to retry, they create a duplicate — and unlike sources, hypotheses/experiments/findings/reports have no backend dedup guard.
- **Root cause**: The shared modal treats `saving` as a submit-button concern only; close affordances aren't part of the busy state, and there's no in-modal error/success slot to anchor the outcome.
- **Impact**: Duplicate hypotheses/experiments/reports and "ghost" rows that appear after the modal is gone; user trust in save state erodes across all eight Research Lab tabs since they share this modal.
- **Fix sketch**: While `saving`, disable the X/Cancel buttons and suppress BaseModal's backdrop/Escape close (or gate `onClose` behind `!saving`). Add an optional `error?: string` prop rendered above the footer so callers can surface failures in place.

## 5. PrototypeTabs is not a tab control to keyboards or screen readers, and its hover style is a no-op
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/research-lab/shared/PrototypeTabs.tsx:31-51
- **Scenario**: A keyboard/screen-reader user lands on the strip that fronts every research-lab page: the container has no `role="tablist"`, buttons have no `role="tab"`/`aria-selected`, and there's no arrow-key navigation, so the active variant is announced identically to inactive ones. Visually, the inactive class `text-foreground hover:text-foreground hover:bg-foreground/[0.04]` sets hover text to the color it already has — inactive tabs should read muted (`text-muted-foreground`) and brighten on hover; as written, active vs inactive differs only by a faint background. The "Prototype" label is also hardcoded English in a fully i18n'd app (13 locales).
- **Root cause**: Scaffolding built as plain buttons; the file's own header says it's throwaway, but it currently gates every Research Lab surface, so its a11y is the plugin's a11y.
- **Impact**: Variant switching is invisible to assistive tech; weak affordance for which prototype is active; one untranslated string.
- **Fix sketch**: Add `role="tablist"`/`role="tab"` + `aria-selected` and ArrowLeft/ArrowRight handling (or reuse an existing shared tabs component); change inactive text to `text-muted-foreground hover:text-foreground`; move "Prototype" under `t.research_lab`.
