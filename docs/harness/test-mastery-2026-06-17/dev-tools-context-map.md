# Test Mastery — Dev Tools & Context Map
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. `finalizeContextScan` outcome → notification routing is entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/features/plugins/dev-tools/sub_context/ContextMapPage.tsx:47-119
- **Current test state**: none
- **Scenario**: `finalizeContextScan` is the single funnel that turns a scan result into (a) a store re-fetch, (b) a process-drawer state transition, and (c) a persistent TitleBar notification. It decides — per `outcome` of `success | warning | failed` — whether to call `fetchContextGroups`/`fetchContexts` (only on success/warning + a non-null project id), which `addProcessNotification` status to emit, and which redirect target. A regression that, e.g., swaps the `success` and `failed` branches, drops the `pid` guard (re-fetching for a null project), or stops re-fetching on `warning` would silently leave the UI showing stale/empty context data after a real scan committed rows — the user thinks the scan "did nothing" and re-runs an expensive codebase scan. None of this is asserted today; the function is a free top-level function (not a hook), so it is directly unit-testable.
- **Root cause**: Logic lives in a component file with no sibling test, and the whole dev-tools plugin tree has zero `*.test.ts(x)` files, so this orchestration was never pinned.
- **Impact**: Data-freshness + user-trust regression on the headline "scan my codebase" flow; wasted LLM/scan spend from needless re-runs; wrong/duplicate notifications.
- **Fix sketch**: Extract `finalizeContextScan` (already exported-shaped — it takes injectable `clearLines`, `t`, `tx`) into a tested unit. Mock the three stores (`useSystemStore`, `useOverviewStore`, `useNotificationCenterStore`) via their `getState`. Assert invariants, not snapshots: (1) success+pid → both `fetchContextGroups` and `fetchContexts` called once with pid; (2) failed → neither called; (3) success with null `activeProjectId` → no re-fetch; (4) `processEnded` arg is `'failed'` iff outcome===failed else `'completed'`; (5) notification `status` maps success→success, warning→warning, failed→failed and always sets `redirectTab:'context-map'`. Use fake timers to flush the 800ms `setTimeout` and assert the final `codebaseScanPhase`.

## 2. `matchAgentsToContext` agent-selection rules have no test (load-bearing for per-context idea scans)
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/plugins/dev-tools/sub_scanner/ideaScannerHelpers.ts:35-52 (imported by ContextMapPage.tsx:14, used at :425)
- **Current test state**: none
- **Scenario**: When the user clicks "scan ideas" on a context card, `ContextMapPage.handleScanContext` calls `matchAgentsToContext(raw)` to pick which scanner agents run — directly driving which LLM agents get invoked (i.e. real token spend) and what findings come back. The 20 `SCAN_MATCH_RULES` regexes are easy to break (a stray `|`, an over-broad pattern matching everything, a typo'd `agentKey` that no longer resolves to a real agent). A regression could silently route every context to the wrong agent set, or collapse to the baseline fallback for contexts that should match security/test/etc.
- **Root cause**: Pure function, no React deps, explicitly documented as "no React dependencies" — clearly meant to be unit-tested, but never was.
- **Fix sketch**: LLM-generatable batch. Invariants to assert (not output snapshots): (1) a context whose keywords contain `auth`/`token` includes `security-auditor`; `test`/`coverage` includes `test-strategist`; etc. — one positive case per rule; (2) the empty/no-match input returns exactly `['architecture-analyst','code-optimizer']` (the documented baseline); (3) result is de-duplicated (no agentKey appears twice even when name+keywords+files all match the same rule); (4) every `agentKey` in `SCAN_MATCH_RULES` is a member of the real agent registry (guards against a typo'd key that silently never runs).

## 3. `scan_codebase` directory-walk (exclusion + grouping + path normalization) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/dev_tools.rs:2396-2504
- **Current test state**: none (the file's `#[cfg(test)]` modules cover goal-status/progress/UAT only)
- **Scenario**: `scan_codebase` walks the project root, skips `node_modules`/`target`/`dist`/`build`/hidden dirs, filters to known source extensions, groups files by first sub-directory (`_root` for top-level files), and normalizes `\` → `/`. This is the fallback codebase mapper that creates `DevContext` rows. A regression in the exclusion set (e.g. forgetting `node_modules`) would map tens of thousands of dependency files into contexts — wrong data, huge DB writes, and downstream the per-context idea scans would burn LLM budget on vendored code. The `key` derivation (root-file vs sub-dir) is subtle and currently unverified.
- **Root cause**: Filesystem-touching logic with non-trivial branching, but no temp-dir-based test was written; the existing repo tests use an in-memory pool and never exercise the walker.
- **Fix sketch**: Add a `#[cfg(test)]` test that builds a `tempfile::tempdir` with a known layout (`src/a.rs`, `node_modules/x.js`, `root.toml`, `.hidden/y.ts`, `dist/z.js`). Assert: (1) `node_modules`/`dist`/`.hidden` produce no contexts; (2) `root.toml` lands under a `_root`/"Root Files" context; (3) `src` context's file paths use forward slashes; (4) only source-extension files are counted in the description. This pins the business rule "we never map vendored/build output".

## 4. Automation delete-guard (block delete while runs pending/running) has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/tools/automations.rs:116-135
- **Current test state**: exists-but-weak — the file's `#[cfg(test)]` covers only `generate_sample_payload`; the delete-guard and trigger in-flight guard are untested
- **Scenario**: `delete_automation` refuses to delete an automation that has a `Pending` or `Running` run, returning a `Validation` error; otherwise it deletes. This is a data-integrity guard against orphaning/aborting in-flight work. A regression (e.g. the `matches!` arm narrowing to only `Running`, or the `.any()` becoming `.all()`) would let a user delete an automation mid-execution, leaving dangling runs and lost work. `trigger_automation` similarly relies on `INFLIGHT_TRIGGERS.guard` + `is_runnable()` to prevent double-fire — also unverified at the command layer (the guard primitive itself is tested, but its *use here* is not).
- **Root cause**: Command-layer guards require a DB pool + repo seeding; the existing test only covered the pure payload helper because it needed no fixtures.
- **Fix sketch**: Add tests over a test pool (mirror the `test_pool()` pattern at dev_tools.rs:4325): seed an automation with a `Running` run → assert `delete_automation` returns `AppError::Validation` and the row still exists; with all runs terminal → assert it deletes. For trigger: assert a non-runnable `deployment_status` yields `Validation` before any runner call.

## 5. `parseJsonArray` / `parseJsonOrDefault` fallback behavior is untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/plugins/dev-tools/sub_context/contextMapTypes.ts:24-26 → src/lib/utils/parseJson.ts:2-10
- **Current test state**: none
- **Scenario**: `ContextMapPage` parses every context's `file_paths`/`keywords`/`entry_points` from DB JSON strings via `parseJsonArray`. If a row holds malformed/legacy JSON, `parseJsonOrDefault` must swallow the error and return `[]` so the Context Map still renders. A regression that lets the parse throw would crash the whole Context Map page for one bad row (the `.map(toItem)` runs over all contexts). The defensive contract is exactly what should be pinned.
- **Root cause**: Small shared util treated as "obviously correct"; no test guards the swallow-and-fallback path.
- **Fix sketch**: LLM-generatable. Assert: `null`/`undefined`/`''` → `[]`; valid `'["a","b"]'` → `['a','b']`; malformed `'[bad'` → `[]` (no throw); a non-array JSON (`'42'`) returns the parsed value as-is (document the actual behavior so callers know the type isn't enforced — or add a guard). Pair with one test that a `ContextItem` built from a bad `file_paths` string still yields an empty array, not a crash.

## 6. `generate_sample_payload` lacks nested/array-value and case coverage on a webhook-bound path
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/commands/tools/automations.rs:26-61 (tests at :204-252)
- **Current test state**: exists-but-weak (adequate for flat string types; gaps on real-world schemas)
- **Scenario**: `test_automation_webhook` sends this payload to a *real external webhook*. The existing tests cover flat string descriptors, special types, concrete values, and invalid schema — good — but miss: (1) case-insensitivity is implemented (`to_lowercase`) yet only lowercase inputs are tested, so an `"URL"`/`"Boolean"` descriptor's behavior is unpinned; (2) the `integer`/`int` and `array`/`list`/`object`/`map` branches have no assertion; (3) an unknown type string (e.g. `"uuid"`) falling through to `sample_{key}` is unverified. A regression here sends garbage to a customer's webhook endpoint.
- **Root cause**: Initial test batch covered the common branches; the `match` arms added later weren't back-filled.
- **Fix sketch**: Extend the existing `tests` module: assert `"URL"`/`"BOOLEAN"` map identically to lowercase; `"integer"`→`0` (number); `"array"`→`[]`, `"object"`→`{}`; unknown descriptor `"uuid"`→`"sample_<key>"`. Invariant: output is always valid JSON and never echoes a raw type descriptor as a value.

## 7. `relativeTime` helper is locale/time-dependent and untested
- **Severity**: low
- **Category**: flaky-nondeterministic
- **File**: src/features/plugins/dev-tools/sub_scanner/ideaScannerHelpers.ts:54-60
- **Current test state**: none
- **Scenario**: `relativeTime` computes `Date.now() - new Date(iso)` and buckets to `s/m/h/d ago`. It is a pure function but reads wall-clock `Date.now()`, so any test must freeze time. Boundary bugs (off-by-one at the 60s/3600s thresholds, negative durations for future timestamps) would show "0s ago" or wrong labels in the scanner UI. Low blast radius (display only) but a cheap, deterministic win.
- **Root cause**: No test; relies on `Date.now()` which must be mocked to be deterministic.
- **Fix sketch**: With `vi.useFakeTimers()` + `vi.setSystemTime(...)`, assert each bucket boundary (59s→"s", 60s→"1m", 3599s→"m", 3600s→"1h", etc.) and a future timestamp degrades gracefully. Note for the suite: this is the canonical "freeze the clock" determinism guard — add it as the pattern other time-based dev-tools tests follow.
