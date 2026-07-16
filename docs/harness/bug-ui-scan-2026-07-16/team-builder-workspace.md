# Team Builder & Workspace — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 3, Medium: 1, Low: 1)

## 1. Closing the Auto-Team modal mid-apply silently orphans a half-built team
- **Severity**: High
- **Category**: bug
- **File**: src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:30-38 (with src/features/teams/sub_teamWorkspace/useAutoTeam.ts:120, 151, 180)
- **Scenario**: User clicks "Create team", and while phase is `applying`/`seeding` presses Escape or clicks the backdrop. `AutoTeamModal` hides its X button while working, but `BaseModal` still calls `onClose` on Escape (BaseModal.tsx:199-201) and on overlay click (BaseModal.tsx:283). The parent sets `open=false`, the modal's effect calls `at.reset()`, which flips `cancelledRef.current = true`.
- **Root cause**: The cancellation flag was designed for "user pressed reset before anything committed", but `apply()` checks it *after* the team (and possibly all members) are already persisted — `if (cancelledRef.current) return;` at useAutoTeam.ts:120/151/180 exits without the rollback that the member-failure path has (`deleteTeam` at :147), without `fetchTeams()`, and without any user-facing message. Only the pre-preview Escape is intercepted (`handleKeyDown` covers `previewing` only).
- **Impact**: A real team row (plus zero-to-all members, no connections, no seeded memories) is left in the DB with the user believing nothing happened; it surfaces later on the teams list as a mystery half-wired team that will stall if executed.
- **Fix sketch**: While `isWorking`, pass a no-op `onClose` to `BaseModal` (or a `disableClose` prop) so Escape/backdrop can't interrupt an in-flight apply; alternatively, on cancellation after `createTeam` succeeded, run the same `deleteTeam` rollback used by the member-failure path.

## 2. `retry_failed_members` has no single-flight guard — concurrent retries duplicate personas and members
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/teams/../../engine/team_preset_adopter.rs:580-612 (guard exists only in `adopt_preset`, line 66/227)
- **Scenario**: Adoption leaves 3 failed roles; the user double-clicks "Retry 3 failed" (or clicks again while the first retry is adopting — each member runs a full LLM-free but multi-step `instant_adopt_template_inner`, so the window is seconds long). Both invocations read `team_repo::get_members` *before* either has inserted anything, so both see the roles as absent, both pass the `role_to_member_id.contains_key(role)` idempotency skip, and both adopt.
- **Root cause**: `adopt_preset` is protected by `ADOPT_INFLIGHT` (per-preset `InflightGuard`) precisely because "nothing in the path is idempotent", but `retry_failed_members` — the same non-idempotent pipeline — relies on a read-then-write check whose read happens before the concurrent writer commits. The doc comment claims double-click safety ("silently skipped rather than failed"), which only holds for *sequential* retries.
- **Impact**: Duplicate personas created in the personas table, duplicate team members stacked at identical (x, y) canvas positions, and doubled handoff triggers after `wire_team_handoff` — a team that fires each stage twice per pipeline run. Cleanup is manual.
- **Fix sketch**: Wrap `retry_failed_members` in the same `ADOPT_INFLIGHT.guard(preset_id)` (or a `team_id`-keyed guard) so a concurrent retry returns the existing `RateLimited` error, matching `adopt_preset`.

## 3. Preset gallery and adoption break in a packaged build — every path candidate is dev-machine relative
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/team_preset_loader.rs:85-100 (`templates_root`), 254-267 (`list_presets` returns empty)
- **Scenario**: User installs the production bundle (the repo does produce one — v0.1.0-x Tauri builds) and opens the Presets gallery. `templates_root()` probes `scripts/templates` (CWD-relative — an installed app launches with CWD = install dir or `C:\Windows\System32` from a shortcut), `../scripts/templates`, and `env!("CARGO_MANIFEST_DIR")/../scripts/templates` — a path baked at compile time that points at the *build machine's* checkout and does not exist on the user's disk.
- **Root cause**: The loader assumes the repo checkout is present next to the running binary. That holds for `tauri dev`/`cargo test` (the two cases the doc comment enumerates) but the manifests are never declared as Tauri bundle resources, and no `app.path()` resolver-based candidate exists.
- **Impact**: In any installed build the gallery renders permanently empty (silent `Vec::new()`, no error surfaced), `get_preset`/`adopt_preset` return `NotFound`, and `load_template_design_by_id` fails member adoption — the entire preset feature is dev-only while looking like "no presets exist".
- **Fix sketch**: Bundle `scripts/templates/**` as Tauri resources and add a candidate resolved via `AppHandle::path().resource_dir()` (threading a handle or resolved base path into the loader); at minimum, log at error level and surface a structured "presets unavailable" state instead of an empty gallery.

## 4. Unstable `at` effect dependency re-arms the focus timer every render — focus is stolen from the role-edit inputs
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/teams/sub_teamWorkspace/AutoTeamModal.tsx:30-38
- **Scenario**: In the previewing phase the user clicks into a member's role input (BlueprintPreview.tsx:58) and types. `useAutoTeam` returns a fresh object literal every render (useAutoTeam.ts:278-293), so the `useEffect` keyed on `[at, open]` re-runs on *every* keystroke's render, clearing and re-scheduling `inputRef.current?.focus()`. 100 ms after the user pauses typing, focus jumps out of the role field into the main query input.
- **Root cause**: The effect is meant to run once per open/close transition, but its dependency is the hook's per-render return object rather than the stable `open` boolean (plus stable `reset` callback). The same instability also calls `at.reset()` on every parent re-render while the modal is closed (harmless today only because React bails on identical state).
- **Impact**: Editing a role becomes fighting the modal for focus — mid-edit caret loss, characters typed into the wrong field, and Enter in the (now focused) query input can trigger `apply()` with a role edit half-finished. Undermines the whole "edit before apply" affordance.
- **Fix sketch**: Depend on `[open]` and reference `at.reset` via a ref (or destructure the stable `reset` callback: `const { reset } = at; useEffect(..., [open, reset])`), and only focus when transitioning from closed to open.

## 5. OptimizerPanel hardcodes English pluralization, bypassing the 13-locale i18n system
- **Severity**: Low
- **Category**: ui
- **File**: src/features/teams/sub_canvas/components/OptimizerPanel.tsx:57, 85
- **Scenario**: A non-English-locale user (the app ships 13 locales with a lefthook gate enforcing key parity) opens the canvas optimizer: the toggle shows "3 suggestions" and the stats bar shows "12 runs" — raw English `suggestion{s ? '' : 's'}` / `run{s}` string concatenation — while every neighboring string in the same component correctly goes through `t.pipeline.*` (e.g. `pt.success_rate` with `{rate}` substitution on line 91).
- **Root cause**: The count badges were added inline with JS ternary pluralization instead of the established one/other key pair pattern already used elsewhere in this context (`auto_team_agents_one`/`auto_team_agents_other` via `tx()` in BlueprintPreview.tsx:90-94).
- **Impact**: Mixed-language UI in localized builds and untranslatable grammar (many supported locales don't pluralize with "+s"), inconsistent with the component's own surrounding strings.
- **Fix sketch**: Add `optimizer_suggestions_one/other` and `optimizer_runs_one/other` keys to the locale files and render via the existing `tx()` count pattern used in BlueprintPreview.
