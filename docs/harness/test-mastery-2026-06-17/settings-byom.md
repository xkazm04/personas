# Test Mastery — Settings & BYOM
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. CORS origin allowlist (`is_trusted_management_origin`) has no tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/management_api.rs:147-157
- **Current test state**: none
- **Scenario**: This predicate is the only thing stopping an arbitrary website from `fetch()`-ing the loopback management API (which hosts `/api/execute`, `/api/proxy/{credential_id}`, version rollback, `/api/build`) cross-origin and reading the response. The function's own doc comment spells out the threat: with `allow_origin(Any)` a single Bearer-token leak becomes weaponizable from any browser tab. A future refactor that loosens the matcher — e.g. switching `origin.starts_with("http://localhost:")` to a `contains`, or adding a trailing wildcard — would silently re-open the hole. No test asserts which origins pass vs. fail, so the regression ships green.
- **Root cause**: The mgmt_api test module exhaustively covers agent-card building, A2A task shaping, and system-key caching, but never touches the CORS allowlist or auth middleware — the two genuinely security-bearing functions in the file.
- **Impact**: Credential-bearing, state-changing API exposed cross-origin to malicious web pages; full account/credential compromise from a drive-by tab.
- **Fix sketch**: Pure-function unit tests (no DB needed). Assert TRUE for `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`, `http://localhost`, `http://localhost:1420`, `http://127.0.0.1`, `http://127.0.0.1:9420`. Assert FALSE for `http://evil.com`, `https://localhost.evil.com`, `http://localhost.evil.com`, `http://notlocalhost:1420`, `http://10.0.0.5`, `https://localhost:1420` (note: https on a port is NOT in the allowlist — pin that), empty string. Invariant: "only the app's own webview + loopback dev origins are trusted; lookalike hostnames are rejected."

## 2. `require_api_key` auth middleware is untested (missing/invalid/revoked token behavior)
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/management_api.rs:167-197
- **Current test state**: none
- **Scenario**: Every management route is gated by this middleware. It must reject (401) a missing `Authorization` header, a non-`Bearer` header, an unknown token, and a revoked/disabled token, and accept a valid one. The underlying repo (`find_by_token`) is well-tested, but the HTTP gate that wires it in — the `strip_prefix("Bearer ")` parsing, the 401-vs-500 branch on lookup error, the "never log plaintext" promise — is not. A refactor that, say, accepts on `Ok(None)` instead of rejecting, or fails open on a DB error, would let unauthenticated callers execute personas and proxy credentials.
- **Root cause**: Middleware was added with defensive comments but no behavioral test; the team tested the data layer and assumed the glue.
- **Impact**: Auth bypass on a credential-bearing, persona-executing HTTP surface — the highest-blast-radius regression in this context.
- **Fix sketch**: Integration test against the router via `tower::ServiceExt::oneshot` (axum's standard test pattern) on an in-memory pool (the `test_pool()` helper already exists in this module). Cases: no header → 401; `Authorization: Basic xxx` → 401; `Bearer bogus` → 401; create a key via the repo then `Bearer <plaintext>` on `GET /api/personas` → 200; revoke it, retry → 401. Invariant: "no valid `external_api_keys` row ⇒ request never reaches a handler." Also assert an OPTIONS preflight is NOT rejected by auth (the comment at line 118-120 claims this ordering; nothing tests it).

## 3. `validateByomPolicy` (frontend mirror of Rust `ByomPolicy::validate`) has no tests
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/settings/sub_byom/libs/byomHelpers.ts:60-152
- **Current test state**: none
- **Scenario**: This client-side validator is a hand-maintained mirror of `byom.rs::validate()` and is what actually gates the Save button (`hasBlockingErrors`). The security-critical rule — an unknown provider in `blocked_providers` is severity `error` (because the Rust evaluator `filter_map`-drops un-parseable entries, so a typo like `claude-code` would make the block a no-op at execute-time) — lives in both languages and can silently drift. The Rust side has ~15 tests for this exact logic; the TS twin has zero. If someone downgrades the blocked-typo case to `warning` (or `info`) in TS, the UI lets the admin save a policy whose block never fires.
- **Root cause**: The mirror was written with a comment promising parity but no parity test; no per-area gate forces a test when this file changes.
- **Impact**: BYOM block bypass — a provider the admin believes is forbidden still receives persona secrets — surfaced as a green Save with no warning.
- **Fix sketch**: LLM-generatable pure-function batch. Mirror the Rust test cases 1:1 so drift is caught: (a) `enabled:false` ⇒ no warnings; (b) unknown in `blocked_providers` ⇒ exactly one `error` top_level warning; (c) unknown in `allowed_providers` ⇒ `info`; (d) compliance rule allowing a blocked provider ⇒ `error`; (e) compliance/routing rule allowing a provider outside non-empty `allowed_providers` ⇒ `warning`; (f) clean policy ⇒ `[]`; (g) disabled rules are skipped. Assert the invariant "blocked-list typo is always severity `error`" explicitly, and assert `ruleType`/`ruleIndex` so the per-rule UI highlighting stays correct.

## 4. `handleSave` policy-wipe guard is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/settings/sub_byom/libs/useByomSettings.ts:132-172
- **Current test state**: none
- **Scenario**: When the initial policy load fails (corrupt stored JSON OR a transient IPC error), the in-memory `policy` is `defaultPolicy()` — empty allow-lists, no rules, `enabled:false`. The guard at line 141 (`if (!loaded || corruptPolicyError !== null)`) refuses to save in that state precisely so a Save click can't overwrite a real on-disk policy with an empty default. The comment explicitly calls this a security regression if it breaks. There is no test that a save is blocked when `corruptPolicyError` is set, nor that `setByomPolicy` is NOT invoked in that path, nor that a blocking-error policy is refused (line 148). A refactor reordering the guards, or saving the snapshot before the guard, would re-introduce the silent wipe.
- **Root cause**: Hook logic (dirty tracking, save guard, concurrent-click guard via `saveInFlightRef`) has no test harness despite `@testing-library/react` + `tauriMock` being available and used widely in the repo.
- **Impact**: BYOM policy silently reset to "all providers allowed" — every provider regains access to persona secrets — triggered by a corrupt-JSON load + an innocent Save click.
- **Fix sketch**: `renderHook(useByomSettings)` with `tauriMock`. Case A: mock `get_byom_policy` to reject → `corruptPolicyError` set, call `handleSave`, assert `set_byom_policy` was never invoked and an error toast fired. Case B: load a non-empty policy, set a blocked-list typo, call `handleSave`, assert refusal. Case C: happy path persists exactly the snapshot and clears dirty. Also assert the double-click guard (`saveInFlightRef`) issues only one `set_byom_policy` on two rapid calls.

## 5. BYOM IPC client (`src/api/system/byom.ts`) has no thin-wrapper tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/api/system/byom.ts:25-61
- **Current test state**: none
- **Scenario**: Sibling API modules (`system.test.ts`, `settings.test.ts`, `credentials.test.ts`) all have wrapper tests asserting each function maps to the right command name + argument shape and rejects on backend error. `byom.ts` — covering `get/set/delete/validate` policy, audit log, usage stats/timeseries, and `testProviderConnection` — has none. A typo'd command name (`get_byom_policy` → `get_byom_policy_v2`) or a renamed arg key (`providerId` vs `provider_id`) would only surface at runtime in the Settings panel, not in CI.
- **Root cause**: New API module shipped without following the established `api/__tests__/*.test.ts` convention.
- **Category note**: Largely llm-generatable from the existing `system.test.ts` template.
- **Impact**: Silent breakage of the entire BYOM settings panel (load, save, connection test) on a backend command rename or arg-shape change.
- **Fix sketch**: Copy the `system.test.ts` pattern: `mockInvoke("get_byom_policy", {...})` ⇒ assert returned shape; `setByomPolicy(p)` ⇒ assert command + `{ policy }` arg; `getProviderUsageTimeseries(30)` ⇒ assert `{ days: 30 }`; `testProviderConnection("claude_code")` ⇒ assert `{ providerId }`; one `mockInvokeError` rejection case. Invariant: command names + arg keys match the Rust `#[tauri::command]` signatures.

## 6. `isStaleKey` (API-key staleness heuristic) is an untested pure function
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:46-55
- **Current test state**: none
- **Scenario**: This drives the "Stale" warning chip that nudges admins to revoke forgotten keys — a real security-hygiene affordance. It has several boundary branches: revoked/disabled keys are never stale; keys younger than the 7-day grace are never stale; never-used keys past grace ARE stale; `NaN` from a malformed `created_at`/`last_used_at` must fail safe (not crash, not mislabel). None of these branches is tested; an off-by-one on the `>=` vs `>` or a flipped `isNaN` guard slips through, and the chip either never appears (no nudge) or false-flags active keys.
- **Root cause**: Pure helper embedded mid-component (lines 46-55) with no extraction or test; easy to overlook.
- **Impact**: Stale-key nudges stop firing (forgotten high-privilege tokens linger) or fire on healthy keys (alert fatigue → admins ignore the chip).
- **Fix sketch**: LLM-generatable, but make the test deterministic — inject/`vi.setSystemTime` a fixed `now` (the function reads `Date.now()`, see finding 7). Cases: revoked ⇒ false; created 3 days ago ⇒ false; created 10 days ago, never used ⇒ true; created 60 days ago, used yesterday ⇒ false; used 31 days ago ⇒ true; `created_at: "garbage"` ⇒ false (no throw). If easy, extract to a `libs/` helper so it's importable without rendering the component.

## 7. Time-dependent UI logic reads `Date.now()` directly — determinism risk for future tests
- **Severity**: low
- **Category**: flaky-nondeterministic
- **File**: src/features/settings/sub_api_keys/components/ApiKeysSettings.tsx:48-54; src/features/settings/sub_byom/components/ByomProviderList.tsx:70-77,160-208
- **Current test state**: none
- **Scenario**: `isStaleKey` and the provider health-cache TTL (`isCacheFresh`, `HEALTH_CACHE_TTL_MS`) both branch on wall-clock `Date.now()`, and the auto-test effect uses real `setTimeout` staggering plus a module-scoped `healthCache` Map. Any test added later (findings 3-6) that doesn't freeze time or reset the module cache between cases will be order-dependent and intermittently flaky — and the shared `healthCache` leaks state across test files in the same worker.
- **Root cause**: Real timers + module-global mutable cache with no documented reset hook.
- **Impact**: Future test suite becomes flaky/order-dependent, eroding trust in the gate (the exact failure mode the BYOM Rust tests avoided with per-test in-memory DBs).
- **Fix sketch**: When writing the above tests, standardize on `vi.useFakeTimers()` + `vi.setSystemTime(fixed)` and clear `healthCache` in `beforeEach`. Optionally expose a tiny `__resetHealthCacheForTests()` (or accept `now`/`timeout` params) so determinism is structural rather than per-test discipline. No production behavior change required.
