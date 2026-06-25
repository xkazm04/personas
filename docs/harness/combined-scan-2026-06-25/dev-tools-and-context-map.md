# Dev Tools & Context Map — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: dev-tools-and-context-map | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. GitHub `owner`/`repo`/`base_branch` interpolated into API URLs with no validation or encoding
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: injection / URL path confusion (SSRF-adjacent)
- **File**: src-tauri/src/commands/tools/github_platform.rs:44 → src-tauri/src/engine/platforms/github.rs:406 (also :288, :334, :371, :442)
- **Scenario**: `github_create_patch_release(credential_id, owner, repo, base_branch, dry_run)` forwards the three caller-supplied strings unmodified to `create_patch_release`, which builds `format!("https://api.github.com/repos/{owner}/{repo}/compare/{base}...{head}")` (head = `base_branch`) and friends, then hands them to `reqwest::get(&url)`. Nothing validates or percent-encodes them. `owner="../.."` / `repo=".."` lets the `url` crate's dot-segment normalization collapse `repos/../../X` to `https://api.github.com/X`, redirecting the call to a *different* GitHub API endpoint under the user's PAT. `base_branch="main?per_page=1"` / `"main#"` injects query/fragment into the compare and release-create requests.
- **Root cause**: The GitHub client trusts its path components. This directly contradicts the sibling n8n client (`engine/platforms/n8n.rs:13` `validate_workflow_id`, plus webhook origin pinning at :232) which was explicitly hardened against exactly this — the GitHub path was never given the same treatment.
- **Impact**: API-endpoint confusion within api.github.com using the caller's real token (wrong repo acted on, request to an unintended endpoint, or a silently malformed compare that returns bogus `ahead_by` and cuts/skip a release incorrectly). Bounded to api.github.com + the PAT's scope, hence High rather than Critical, but it is unsanitized URL construction on a `#[requires(privileged)]` command reachable from MCP/companion, not just a hand-typed UI field.
- **Fix sketch**: Validate `owner`/`repo` against `^[A-Za-z0-9._-]+$` and `base_branch` against GitHub's ref grammar (reject `..`, `?`, `#`, whitespace, `/`-prefix) before use, mirroring `validate_workflow_id`; or build the path with `Url::parse(...).join()` / `path_segments_mut()` so segments are encoded rather than string-interpolated.
- **Value**: impact=6 effort=2

## 2. `test_automation_webhook` bypasses both the runnable gate and the single-flight guard that `trigger_automation` enforces
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: missing precondition / safety-gate bypass
- **File**: src-tauri/src/commands/tools/automations.rs:170-192
- **Scenario**: The real run path `trigger_automation` (:147) refuses to fire unless `automation.deployment_status.is_runnable()` and (:154) takes `INFLIGHT_TRIGGERS.guard(&id)` so the same automation cannot be triggered twice concurrently. The "Test" path `test_automation_webhook` does neither — it loads the automation, generates a sample payload, and calls `invoke_automation` immediately. So a paused/draft/disabled automation still POSTs its **live** webhook (real n8n workflow → real emails / writes), and a Test can race a concurrent real trigger of the same automation, defeating the double-fire protection.
- **Root cause**: The "test" affordance was treated as side-effect-free, but it shares `invoke_automation` with the production trigger and skips that function's guards.
- **Impact**: A disabled automation fires real external side effects from a button labeled "Test"; concurrent Test + Trigger double-fires a workflow that single-flight was meant to prevent.
- **Fix sketch**: In `test_automation_webhook`, apply the same `is_runnable()` check and acquire `INFLIGHT_TRIGGERS.guard(&id)` before invoking (or document explicitly that Test fires the live endpoint and gate it behind a confirmation).
- **Value**: impact=5 effort=2

## 3. `clear_project_context_map` wipes the map across three non-atomic deletes and swallows the relationship-delete error
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data integrity / silent partial failure
- **File**: src-tauri/src/db/repos/dev_tools.rs:2103-2128
- **Scenario**: The "clean slate before rescan" runs three independent `conn.execute` deletes (contexts, relationships, groups) under SQLite autocommit — not a transaction. If the process dies or a lock/error hits after `DELETE dev_contexts` but before `DELETE dev_context_groups`, the contexts are gone while the groups (or relationships) survive, leaving empty/orphaned groups. The relationship delete is additionally bound with `let _ = rel_rows;` (:2120), swallowing any real error (lock, corruption) behind a comment that only anticipates an empty table.
- **Root cause**: Per-statement autocommit instead of one transaction. The same file's `replace_file_hashes` (:2184) correctly wraps its delete+insert in `conn.transaction()`, so the atomic pattern was available and just not used here.
- **Impact**: A failed/interrupted rescan can leave a half-wiped context map (groups with no contexts, or stale relationships) that the UI then renders as the project's real decomposition — a silently wrong grouping.
- **Fix sketch**: Open `conn.transaction()`, run all three deletes (propagating the relationship-delete error), `commit()`.
- **Value**: impact=5 effort=2

## 4. Dead, symlink-following `scan_codebase` walker shadows the live scanner (recursion landmine + duplicate-naming ambiguity)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: dead code / unbounded recursion / naming collision
- **File**: src-tauri/src/db/repos/dev_tools.rs:2456-2564
- **Scenario**: This `pub fn scan_codebase` recursively `visit_dir`s the project tree, but it has **no callers** — the live scan is the background job in `commands/infrastructure/context_generation.rs` (`dev_tools_scan_codebase`). The dead copy (a) recurses on `path.is_dir()` (:2502), which follows symlinks with no depth or visited-set guard, so a symlink loop (`a -> ..`) is infinite recursion → stack-overflow crash and a symlink pointing outside the repo is silently traversed; (b) never clears existing rows, so each run duplicates every context; (c) carries the exact name (`scan_codebase`) of the real entry point, so a maintainer can easily wire/extend the wrong one.
- **Root cause**: Legacy heuristic scanner left in the repo after the Claude-CLI background scanner superseded it; never deleted.
- **Impact**: Latent crash + arbitrary-directory traversal + duplicate contexts the day anyone calls it; today, ongoing confusion about which `scan_codebase` is authoritative.
- **Fix sketch**: Delete the function (preferred), or if kept, add a symlink/visited guard + depth cap and `clear_project_context_map` before insert, and rename it (e.g. `scan_codebase_heuristic_legacy`) with a doc-comment pointing at the live scanner.
- **Value**: impact=4 effort=2

## 5. A failed/cancelled context scan does not refetch, leaving the UI on a stale (possibly already-wiped) map
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: stale state / silent inconsistency
- **File**: src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx:66-70 (`finalizeContextScan`)
- **Scenario**: `finalizeContextScan` only calls `fetchContextGroups`/`fetchContexts` on `success` or `warning` (:67). On `failed`/`cancelled` it skips the refetch. Because the backend rescan clears the map before rebuilding (finding #3), a scan that fails *after* the clear leaves the DB empty/partial while the React store still holds the pre-scan groups. The user keeps seeing the old map and can act on it (e.g. `onScanContext` for a context id that no longer exists) until a manual reload.
- **Root cause**: The "refetch on completion" was scoped to the happy paths; failure is assumed to mean "nothing changed," which isn't true once a clear-then-rebuild has started.
- **Impact**: Stale/wrong groupings shown after a partial-then-failed rescan; follow-up per-context actions target ids the DB no longer has.
- **Fix sketch**: Refetch contexts/groups on the `failed`/`cancelled` branch too (cheap, idempotent), so the UI reconciles to whatever actually survived.
- **Value**: impact=3 effort=1
