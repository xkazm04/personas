> Context: tauri:engine (misc)
> Total: 8
> Critical: 0  High: 1  Medium: 3  Low: 4

## 1. Fallback credential resolution poisons `seen_connectors`, silently skipping later tools' connectors
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/engine/runner/credentials.rs:70-171
- **Scenario**: A persona has tool A (`requires_credential_type="slack"`, listed in no connector's `services`) and tool B (listed in the `notion` connector's `services`). Tool A misses the primary match, enters the fallback loop (line 113) which iterates **every** connector and calls `seen_connectors.insert(connector.name)` on each — including non-matching ones like `notion` — before the `connector_matches` check. Now `seen_connectors` contains `notion`. Tool B's primary loop hits `!seen_connectors.insert("notion")` (line 83) → returns false → `continue`, so `notion`'s credentials are never injected. Tool B silently runs with no credential env vars.
- **Root cause**: The fallback loop marks a connector "seen" as a side effect of the `if !seen.insert(...) { continue; }` guard placed *before* the match test, conflating "iterated" with "consumed". The primary loop (correctly) only inserts on a real match because `||` short-circuits.
- **Impact**: security/UX — multi-tool personas whose tools resolve via different connectors get "connector unavailable" at runtime for the second+ tool; the last-resort direct `service_type` lookup (line 149) only masks it when `requires_credential_type` is set and a bare credential row happens to match.
- **Fix sketch**: In the fallback loop, test `connector_matches` first and only insert into `seen_connectors` when the connector actually matches (mirror the primary loop's short-circuit): `if !connector_matches || !seen_connectors.insert(connector.name.clone()) { continue; }`.

## 2. Google family can emit `GOOGLE_ACCESS_TOKEN` twice with conflicting values
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/runner/credentials.rs:797-811
- **Scenario**: A persona links both a `google` connector and a `google_calendar` connector. For `google_calendar` the alias block (prefix `GOOGLE_CALENDAR` ≠ `GOOGLE`) pushes `("GOOGLE_ACCESS_TOKEN", <gcal token>)`. For `google` the normal field loop pushes `("GOOGLE_ACCESS_TOKEN", <google token>)`. `env_vars` is a `Vec<(String,String)>` with no de-dup, so two `GOOGLE_ACCESS_TOKEN` entries with different values reach the spawn env map; which one the child sees depends on insertion order / how the map is built downstream.
- **Root cause**: The Google alias is pushed unconditionally per-connector without checking whether a canonical `GOOGLE_*` var was already produced by another connector in the same execution.
- **Impact**: UX/correctness — non-deterministic account selection when two Google-family credentials are linked; the "wrong account" symptom this file's 2026-05-04 note tried to eliminate.
- **Fix sketch**: Before pushing an alias, skip if `env_vars.iter().any(|(k,_)| k == "GOOGLE_ACCESS_TOKEN")`; or de-dupe `env_vars` by key (last-wins) once at the end of resolution.

## 3. Frame-snap collapses a sub-frame clip into an I2 violation that fails the whole compile
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/render_plan/compile.rs:809-856
- **Scenario**: A video clip with `start_time=0.0`, `duration=0.01` at `fps=30` passes the `duration <= 0.0` guard (line 523). In the frame-snap pass `output_start = snap(0.0) = 0.0` and `output_end = snap(0.01) = round(0.3)/30 = 0.0`. Now `output_end <= output_start`, which `assert_invariants` (I2, invariants.rs:52) rejects, so `compile` returns `UnsupportedCompositionShape` and the entire composition fails to render — not just the tiny clip.
- **Root cause**: Snapping rounds both boundaries independently; a clip shorter than half a frame rounds to a zero-length window, and nothing re-expands it to a minimum of one frame.
- **Impact**: UX — one accidental sub-frame item (easy to author by dragging) blocks preview/export of an otherwise valid timeline.
- **Fix sketch**: After snapping, enforce a one-frame floor: `if s.output_end <= s.output_start { s.output_end = s.output_start + 1.0/fps_f; }` (and reconcile `source_end`), or reject sub-frame durations up front with a targeted warning rather than a hard compile error.

## 4. Standards policy renders an empty PR base branch when `test` is selected but `test_env_branch` is unset
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/engine/runner/team_context.rs:249-259
- **Scenario**: `test_b = project.test_env_branch.as_deref().unwrap_or("")`. If a project's branching config sets `pr_base: "test"` but `test_env_branch` is not configured, `resolve_branch("test")` returns `""`, so the injected prompt says *"Open pull requests against the branch ``"* and the implementer/QA get a blank branch target.
- **Root cause**: The empty-string fallback for `test_env_branch` is treated as a valid branch name by `resolve_branch`.
- **Impact**: UX — team personas receive a malformed branching directive; PRs may target the wrong/blank branch.
- **Fix sketch**: Fall back to `main_b` when the resolved `test` branch is empty: `if sel == "test" && !test_b.is_empty() { test_b } else { main_b }`.

## 5. Duplicated project-resolution logic across `resolve_standards_policy` and `gather_active_goals`
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/runner/team_context.rs:232-245, 330-343
- **Scenario**: Both functions resolve the project id with the identical block: `persona.parsed_design_context().dev_project_id.filter(|p| !p.is_empty()).or_else(|| <query dev_projects WHERE team_id=?1 LIMIT 1>)`. Verified by direct comparison — the two spans are byte-for-byte equivalent except the trailing `?` (one returns `Option`, one keeps it).
- **Root cause**: The pinned-project-or-team-fallback lookup was copy-pasted into each consumer rather than extracted.
- **Impact**: maintainability — a change to project resolution (e.g. honoring a new pin field) must be made in two places; they can silently drift.
- **Fix sketch**: Extract `fn resolve_team_project_id(pool, persona, team_id) -> Option<String>` and call it from both sites.

## 6. Repeated Google/Microsoft connector-family predicate
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/runner/credentials.rs:553-561, 676-682, 799-803
- **Scenario**: The "is this a Google connector" test (`name.starts_with("google") || name == "gmail" || name == "google_calendar" || name == "google_drive" [|| "google_sheets"]`) is spelled out three times, with the alias site (799) additionally including `google_sheets` while the token-endpoint site (553) does not — an inconsistency that could cause a `google_sheets` credential to get the alias but no refresh endpoint.
- **Root cause**: Ad-hoc inline family checks instead of one predicate.
- **Impact**: maintainability/correctness — the sets have already drifted (`google_sheets`); a new Google sub-service must be added in ≥3 places.
- **Fix sketch**: Add `fn is_google_family(name: &str) -> bool` / `is_microsoft_family` and use them everywhere so the membership set is defined once.

## 7. Dead I9 frame-alignment block in the invariant checker
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/render_plan/invariants.rs:165-179
- **Scenario**: The `if !is_frame_aligned(...) || ... { ... }` has an empty body — only comments explaining why I9 is "soft". The condition is evaluated (four `is_frame_aligned` calls) but can never affect control flow; no violation is ever returned for I9 on the video track.
- **Root cause**: An intended soft-check was stubbed out but left as executable no-op code, which reads as a real validation to a maintainer.
- **Impact**: maintainability — misleading; a reader believes frame-alignment is enforced here when it is not.
- **Fix sketch**: Either delete the `if` entirely and keep only the explanatory comment, or move the check behind an explicit `assert_invariants_opts(frame_snap: bool)` and actually return a violation when enabled.

## 8. 230-line inline changelog comment inside `minimum_version`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: oversized-module
- **File**: src-tauri/src/engine/provider/claude.rs:56-294
- **Scenario**: `minimum_version` returns a single `Some("2.1.199")` but carries ~230 lines of CLI-release research notes inline, dwarfing the function and the rest of the file. The narrative is valuable but is version-history documentation, not code.
- **Root cause**: The research log accretes in the function body on every `/research` run instead of living in a doc.
- **Impact**: maintainability — the file's actual logic (4 lines) is buried; diffs on this function are dominated by prose churn.
- **Fix sketch**: Move the historical floor narrative to `docs/` (or the existing `Patterns/` note referenced at the bottom) and leave a one-line pointer plus the current floor rationale next to `Some("2.1.199")`.
