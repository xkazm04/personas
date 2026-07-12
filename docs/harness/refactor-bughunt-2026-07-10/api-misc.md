> Context: api (misc)
> Total: 5
> Critical: 0  High: 0  Medium: 2  Low: 3

Note: 18 files, nearly all are thin `invokeWithTimeout` IPC wrappers over Rust Tauri commands (the real logic lives in `src-tauri/`). The bug surface in this TS layer is therefore small; findings below are the substantiable ones. Callers were grepped across `src/` to judge dead code.

## 1. Corrupt `scoped_resources` blob silently collapses to "no picks", risking a scoping wipe
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/api/credentials/scopedResources.ts:28-36
- **Scenario**: `getScopedResources` does `JSON.parse(raw)` and on any parse error `catch { return {}; }`. Per the documented contract, `null` = broad scope (never scoped) and `{}` = "picker opened, user skipped". So if the persisted blob is truncated/corrupt, the function hands the picker UI an *empty* pick set indistinguishable from a legitimate skip. If the user then opens the credential's scope picker (seeing no picks) and clicks Save, `saveScopedResources` overwrites the (recoverable) corrupt blob with a genuinely empty one — permanently discarding the real resource restrictions on that credential.
- **Root cause**: the `catch` conflates "unparseable data" with the valid "empty picks" state instead of surfacing the corruption.
- **Impact**: security/data-integrity — a credential's resource scoping can be silently lost; a scoped-then-corrupted PAT can end up broad-scoped after a routine re-save.
- **Fix sketch**: on parse failure, either propagate/throw (let the UI show an error and refuse to render an editable-but-empty picker) or return a distinct sentinel so the save path won't blindly overwrite. At minimum log the raw value before defaulting.

## 2. Dead duplicate binding to `dev_tools_start_batch` with a divergent (maxParallel-less) signature
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: src/api/devTools/devTools.ts:837-838 (vs 852-853)
- **Scenario**: Two exports invoke the *same* Tauri command `dev_tools_start_batch`: `startBatch(taskIds)` (line 837, via `safeInvoke`, no `maxParallel`) and `startBatchExecution(taskIds, maxParallel?)` (line 852, via `invoke`). Grepping all callers: only `startBatchExecution` is used (`devToolsTaskSlice.ts:103`, `NewCompetitionModal.tsx`). The store action *named* `startBatch` actually calls `devApi.startBatchExecution`. No importer references `devApi.startBatch`. The line-837 export is dead, and it silently drops the `maxParallel` argument — a foot-gun if someone picks it by name from autocomplete.
- **Root cause**: leftover from the pre-CLI "queue" batch API when execution was reworked; the old wrapper was never removed.
- **Impact**: maintainability — confusing dual bindings to one command; risk of a future caller wiring the parallelism-less variant.
- **Fix sketch**: delete the `startBatch` export at line 837 (and its `safeInvoke` fallback); keep `startBatchExecution` as the single binding.

## 3. Autopilot mode string is cast to the union without validation
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: trust-boundary / edge-case
- **File**: src/api/devTools/autopilot.ts:12-13, 22-23
- **Scenario**: Both getters do `(v as AutopilotMode | null) ?? null` on a raw `string | null` from Rust. If the backend ever returns a mode string outside `off|measure|suggest|full` (schema drift, a new mode the UI doesn't know, or a stale DB value), it flows through typed as a valid mode. Downstream UI that switches on the four modes will hit no case and render nothing / an undefined state rather than falling back to `off`.
- **Root cause**: `as` cast trusts the backend enum instead of narrowing.
- **Impact**: UX — silent mis-render of the autonomy switch on an unexpected value.
- **Fix sketch**: guard with `const KNOWN = new Set(["off","measure","suggest","full"]); return KNOWN.has(v) ? (v as AutopilotMode) : null;`.

## 4. `getScanCodebaseStatus` "not_found" fallback is indistinguishable from a real terminal status
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/api/devTools/devTools.ts:577-582
- **Scenario**: `safeInvoke` returns the fallback `{ status: "not_found", ... }` when the Tauri command isn't registered (old build). But `"not_found"` is also a value the real command legitimately returns for an unknown/expired scan id. A poller cannot tell "command unavailable in this build" from "backend says this scan id is gone" — both look like a benign terminal state, so a scan that never started may appear to have simply ended.
- **Root cause**: reusing a real domain status string as the command-missing sentinel.
- **Impact**: UX — a missing command silently masquerades as a completed/absent scan; no error surfaced to the user.
- **Fix sketch**: use a distinct sentinel status (e.g. `"unavailable"`) or an explicit `error` field for the command-missing fallback so the poller can differentiate.

## 5. Pervasive redundant `key: key` self-assignments (and double-declared type re-exports) in design.ts
- **Lens**: code-refactor
- **Severity**: low
- **Category**: cruft / duplication
- **File**: src/api/design/design.ts:9-26, 47-51 (and 2-6)
- **Scenario**: Many invoke argument objects spell out no-op self-assignments — `designId: designId`, `currentResult: currentResult`, `conversationId: conversationId`, `structuredPromptJson: structuredPromptJson`, `lastResult: lastResult`, etc. — where object shorthand (`designId,`) is equivalent. Separately, `DesignStartResult` and `FeasibilityResult` are each both `import type`'d (lines 2-3) and `export type`'d from the same module (lines 5-6), a redundant re-declaration.
- **Root cause**: mechanical generation / copy-paste that expanded shorthand.
- **Impact**: maintainability only — noise that obscures the few args that *do* transform (e.g. the `?? null` cases elsewhere in the context).
- **Fix sketch**: collapse the self-assignments to shorthand; replace the split import+export with a single `export type { DesignStartResult, FeasibilityResult } from "..."` and reference them directly. Cosmetic — batch with other churn, don't PR alone.
