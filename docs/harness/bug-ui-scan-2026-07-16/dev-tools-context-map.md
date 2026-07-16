# Dev Tools & Context Map — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. `delete_automation` in-flight check is a capped snapshot with a TOCTOU hole — can delete an automation mid-run, and a crashed run blocks deletion forever
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/tools/automations.rs:117-135
- **Scenario**: (a) User clicks Delete on an automation at the same moment a trigger fires (webhook/event/another window). `delete_automation` reads the last 50 runs, sees none in flight, and between that read and `repo::delete` the trigger passes `is_runnable()`, takes the `INFLIGHT_TRIGGERS` guard, and inserts a `'running'` run — the automation is deleted while its outbound webhook is live. (b) Conversely, if the app crashed/was killed mid-run, the orphaned `'running'` row never transitions, so the delete is rejected forever ("wait for them to complete") with no cancel path. (c) The check only reads `LIMIT 50 ORDER BY started_at DESC` (automations.rs:119, repos/resources/automations.rs:466-486) — a long-running run older than the 50 most recent rows is invisible to the guard.
- **Root cause**: In-flight state is derived from a bounded, point-in-time DB snapshot instead of the actual concurrency primitive. `delete_automation` never consults the same `INFLIGHT_TRIGGERS` guard that `trigger_automation`/`test_automation_webhook` hold, and check→delete is not atomic. There is also no staleness/timeout handling for `'running'` rows.
- **Impact**: Race path: automation row deleted under a live run — the runner's completion update targets a deleted parent (orphaned/cascade-lost run history) while the external webhook side effect already fired. Crash path: automation becomes permanently undeletable.
- **Fix sketch**: Take (or at least test) `INFLIGHT_TRIGGERS.guard(&id)` inside `delete_automation` so delete and trigger serialize on the same primitive; drop the 50-row cap by querying `COUNT(*) ... WHERE status IN ('pending','running')` directly; treat `'running'` rows older than a sane TTL as stale (or offer cancel) so deletion can't be wedged forever.

## 2. Context scan can finalize twice — duplicate completion notifications, double refetch, double `processEnded`
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx:286-296 (fallback timer), 136-142 (deferred `activeScanId` clear)
- **Scenario**: A scan completes. `CONTEXT_GEN_STATUS: completed` arrives and arms a 3s fallback timer guarded only by `activeScanId === currentScanId`. `CONTEXT_GEN_COMPLETE` (which carries the counts) arrives anywhere between ~2.2s and ~3.8s later — e.g. the backend commits a large context map slowly. The COMPLETE handler runs `finalizeContextScan` immediately, but that function clears `activeScanId` only inside an 800ms `setTimeout`. When the 3s fallback fires, `activeScanId` still equals `currentScanId`, so `finalizeContextScan` runs a second time (and the mirror case — fallback first at 3.0s, COMPLETE at 3.5s — double-fires the same way).
- **Root cause**: The idempotency guard (`activeScanId`) is cleared asynchronously 800ms after finalization, while the fallback timer is never cancelled when the real completion event lands — so "already finalized" is unobservable for up to 800ms.
- **Impact**: Two bell notifications for one scan, `processEnded('context_scan')` invoked twice on the overview drawer, duplicate `fetchContextGroups`/`fetchContexts` IPC bursts right when the DB is busiest, and the second (fallback) finalize overwrites the counted notification with a countless one.
- **Fix sketch**: Store the fallback timer id and `clearTimeout` it inside `finalizeContextScan` (or at the top of the COMPLETE handler); alternatively clear `activeScanId` synchronously in `finalizeContextScan` and keep only the visual `codebaseScanPhase` transition on the 800ms delay.

## 3. `clear_project_context_map` silently swallows the relationship-delete error and is not transactional
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/dev_tools.rs:2134-2148
- **Scenario**: A full rescan clears the old map while the pool is under write load (exactly when scans run). The `DELETE FROM dev_context_group_relationships` returns `Err` (e.g. `SQLITE_BUSY`), but the code does `let _ = rel_rows;` — the `Result` is discarded, the function reports success, and the scan proceeds. The three deletes (contexts → relationships → groups) also run as separate statements, so any hard failure between them leaves a half-cleared map with contexts already gone.
- **Root cause**: The comment "ok if table is empty" conflates "0 rows deleted" (an `Ok(0)`, which needs no handling) with a genuine database error; and clear-slate semantics are assumed atomic when they are three independent statements on one connection.
- **Impact**: Stale `dev_context_group_relationships` rows survive pointing at group ids the subsequent group-delete removed — phantom relationship edges attributed to the freshly scanned map; on partial failure, unpinned contexts are destroyed without the compensating cleanup completing.
- **Fix sketch**: Wrap the three deletes in a single `conn.transaction()` and propagate the relationship-delete error with `?` instead of `let _ =`.

## 4. Empty-map detection keys on groups, not contexts — an all-ungrouped map renders the "never scanned" state
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx:523-527 (`hasContexts = storeGroups.length > 0`), 576-584 (action row branch), 594 (view tabs)
- **Scenario**: A project's contexts end up without groups — the user deletes their groups (the `group_id` FK is `ON DELETE SET NULL`, and `groups` even builds a dedicated `__ungrouped__` pseudo-group for exactly this), or a scan yields contexts whose group linkage failed. `hasContexts` is `storeGroups.length > 0`, which is false, so the page shows the first-run "Scan codebase" CTA instead of Re-scan/Full re-scan/Plan update, hides the Cross-tab/Roster+ view switcher, hides "last scanned", and passes `hasMap: false` to the ledger — while the ungrouped contexts are simultaneously visible in it.
- **Root cause**: The variable is named `hasContexts` but measures context *groups*; `lastScannedAt` is likewise derived only from group `updated_at`, so the ungrouped path has no recency signal either. The `__ungrouped__` synthesis in `groups` proves the state is expected, but the gating booleans never accounted for it.
- **Impact**: Contradictory UI — a populated map presented as unscanned; clicking the prominent CTA launches a full scan that deletes and regenerates the user's (unpinned) contexts when they likely only wanted an incremental refresh, and the incremental Re-scan option is unreachable.
- **Fix sketch**: Derive `hasContexts` from `storeContexts.length > 0 || storeGroups.length > 0`, and include context `updated_at` values as a fallback in the `lastScannedAt` reduction.

## 5. ContextDetail close button has no accessible name
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/dev-tools/sub_context/ContextDetail.tsx:139-141
- **Scenario**: A screen-reader or keyboard user opens a context's detail panel and tabs to the header controls. The pin toggle right beside it announces properly ("Pin context", with `aria-pressed`), but the close button is an icon-only ghost `Button` containing a bare `<X>` glyph with no `aria-label`/`title` — it announces as "button" with no name.
- **Root cause**: Icon-only buttons need an explicit accessible name; the adjacent pin button got one (line 130) but the close button was left with only the decorative lucide icon, which renders as an unlabeled SVG.
- **Impact**: The only way to dismiss the panel is unannounced to assistive tech (Escape isn't wired either), an inconsistency within the very same button cluster; fails WCAG 4.1.2 name/role/value.
- **Fix sketch**: Add `aria-label={t.common.close}` (and optionally a matching `title`) to the close Button; consider an Escape-key handler on the aside for parity with modal conventions.
