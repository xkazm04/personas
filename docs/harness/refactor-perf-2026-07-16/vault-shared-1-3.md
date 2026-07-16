# vault/shared [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Dead `RequestResponsePanel` component whose exact JSX is duplicated inline in ApiExplorerTab
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/shared/playground/tabs/ApiExplorerSubComponents.tsx:99
- **Scenario**: `RequestResponsePanel` (lines 88–147) is exported but never imported anywhere in `src/` (verified via repo-wide grep — only its own definition matches). Meanwhile `ApiExplorerTab.tsx:122-146` contains a hand-inlined copy of the exact same request/response panel markup (same grid template, same divider div, same error/response branches).
- **Root cause**: The panel was extracted into a subcomponent but the call site was later rewritten inline (or never switched over), leaving the extracted version orphaned while the duplicate diverges silently.
- **Impact**: ~50 dead lines shipped in the bundle, and any styling/behavior fix to the panel now has one real site and one decoy — a maintainer editing `RequestResponsePanel` sees no effect in the app.
- **Fix sketch**: Either (a) replace `ApiExplorerTab.tsx:122-146` with `<RequestResponsePanel selectedEndpoint={state.selectedEndpoint} response={state.response} sendError={state.sendError} isSending={state.isSending} onSend={state.handleSend} onClose={state.closeRequestPanel} />`, or (b) delete `RequestResponsePanel` and its props interface. Option (a) is preferred since it also removes the duplication. Note: `PasteSpecModal` and `TestRunCounters` in the same file ARE used by ApiExplorerTab — keep those.

## 2. Inline credential-rename widget duplicated between VectorKbModal and PlaygroundHeader
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/shared/vector/VectorKbModal.tsx:68
- **Scenario**: `VectorKbModal.tsx:68-153` and `PlaygroundHeader.tsx:27-146` contain a near-identical block: `isEditingName`/`editName` state, an async `saveName` that calls `credApi.updateCredential` with the same six-field null payload, patches `useVaultStore.credentials`, and swallows errors via `silentCatch`, plus ~40 lines of identical input + Check-button + Pencil-button JSX (same class strings, same Enter/Escape/blur handling).
- **Root cause**: The rename affordance was copy-pasted when the vector KB modal gained a header instead of extracting a shared piece.
- **Impact**: ~90 duplicated lines; behavior fixes (e.g., surfacing the currently-silent save failure, or a change to the update payload contract) must be applied twice, and the two copies already drift on details (title translation keys differ: `sh.save_name` vs `t.vault.ingest.save_name`).
- **Fix sketch**: Extract a `useInlineCredentialRename(credential)` hook returning `{ isEditing, editName, setEditName, start, cancel, save }` plus a small `InlineRenameTitle` component (props: `credential`, `displayName`, `titleId`) under `src/features/vault/shared/components/`. Replace both call sites; the only per-site variation is the displayed name (`kb?.name || credential.name` vs `credential.name`) and the title id.

## 3. `buildReason` switch cases never match — remediation casing mismatch with the Rust binding
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/shared/hooks/health/useRemediationEvaluator.ts:185
- **Scenario**: `buildReason` is called with `anomaly_score.remediation` from `getRotationStatus` (line 104). That value is the ts-rs/serde-serialized `Remediation` enum, which is PascalCase (`"BackoffRetry"`, `"PreemptiveRotation"`, ... — see `src-tauri/src/engine/rotation.rs:221-232`; `actionsForRemediation` in `remediationBus.ts:50` correctly matches PascalCase). But `buildReason` switches on snake_case (`'backoff_retry'`, `'preemptive_rotation'`, `'rotate_then_alert'`, `'disable'`), so every specific case is dead and every dispatched remediation event carries the generic fallback `"Remediation level: BackoffRetry"`.
- **Root cause**: The snake_case strings come from the Rust `Remediation::as_str()` form used for the metadata-embedded ledger copy (`score_to_ledger`, rotation.rs:426), which was conflated with the serde form returned over IPC. (The metadata fast-path check `=== 'healthy'` at line 80 IS correct — metadata uses `as_str()` — only `buildReason` uses the wrong casing.)
- **Impact**: Users never see the descriptive failure-rate reason strings in remediation notifications/logs; four crafted message branches are unreachable dead code. Also a trap: anyone "fixing" the line-80 check to PascalCase by symmetry would break the working fast path.
- **Fix sketch**: Type the parameter as `Remediation` and switch on `'BackoffRetry' | 'PreemptiveRotation' | 'RotateThenAlert' | 'Disable'` (exhaustive, letting tsc catch future enum changes). Add a short comment at line 80 noting that metadata-embedded remediation is snake_case (`as_str()`), while IPC `RotationStatus` is PascalCase.

## 4. Batch API test run re-renders every endpoint row on every result (O(n²) React work + Map copies)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/shared/playground/useApiTestRunner.ts:152
- **Scenario**: During "Run all", each endpoint completion performs 2 `setResults` (running + final), each copying the entire results `Map` (`new Map(prev)`), plus a `setProgress` and 2 `addLog` state updates. Every one of these re-renders `ApiExplorerTab`, which maps all `filtered` endpoints into non-memoized `EndpointRow`s with fresh inline `onToggle`/`onTry` closures. For a spec with N endpoints, a full run does ~4N state updates × N rows rendered = O(n²) render work while requests are in flight at concurrency 5.
- **Root cause**: Per-endpoint granular state updates with an unmemoized row list; each Map copy is also O(n).
- **Impact**: For large OpenAPI specs (hundreds of endpoints — realistic, since this is the generic explorer), the UI visibly stutters and burns CPU for the duration of the batch run; the log strip animates while the whole list thrashes.
- **Fix sketch**: (1) Wrap `EndpointRow` in `React.memo` and stabilize the callbacks — e.g., pass `index` + a single `useCallback` `onToggleIdx(i)` / `onTryEndpoint(ep)` from `useApiExplorerState`. (2) Coalesce runner updates: skip the intermediate "running" `setResults`, or batch result/progress writes through a ~100ms `requestAnimationFrame`/interval flush instead of per-request `setState`. Either half alone removes most of the quadratic cost; both together make runs smooth at any spec size.

## 5. ResponseViewer parses the response body with JSON.parse twice
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: duplicate-work
- **File**: src/features/vault/shared/playground/ResponseViewer.tsx:31
- **Scenario**: Two separate `useMemo`s (`prettyBody` lines 31-40, `isJson` lines 42-45) each `JSON.parse(response.body)` on the same body. Responses can be large (there is a `truncated` flag, so bodies run up to the proxy cap), and both memos recompute together whenever a new response arrives.
- **Root cause**: `isJson` was added as an independent memo instead of being derived from the existing parse attempt.
- **Impact**: Doubles the parse cost of every viewed response; bounded (one response at a time, capped size), hence Low — but it is free to fix.
- **Fix sketch**: Merge into one memo returning `{ prettyBody, isJson }`: try `JSON.parse` once; on success return the stringified pretty form with `isJson: true`, on failure return the raw body with `isJson: false`.
