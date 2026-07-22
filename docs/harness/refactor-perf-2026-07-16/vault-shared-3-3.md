# vault/shared [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 12 | Missing: 0

## 1. `ResponseView` component is dead code (never imported anywhere)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/shared/playground/tabs/ResponseView.tsx:9
- **Scenario**: A repo-wide grep for `ResponseView` shows the component is defined and exported here but has zero importers; both live consumers of the response panel (`ApiExplorerTab.tsx:141`, `ApiExplorerSubComponents.tsx:141`) render `ResponseViewer` directly with their own inline error/response markup.
- **Root cause**: The response panel was superseded by inline rendering in the API explorer refactor; the extracted wrapper was left behind. It also carries a telltale leftover: an empty `<div className="bg-primary/25" />` (line 13) that renders nothing useful — a remnant of a removed grid divider.
- **Impact**: A whole orphaned file that future readers will assume is live (its name overlaps with the actively-used `ResponseViewer`), plus dead markup that misleads about layout intent.
- **Fix sketch**: Delete `ResponseView.tsx`. It is a named export with no barrel re-export and no dynamic usage pattern in this codebase; verification needed only for out-of-src callers (none expected in a Tauri app). If a shared error+response panel is actually wanted, extract the duplicated inline block from `ApiExplorerTab`/`ApiExplorerSubComponents` instead and wire both to it.

## 2. `formatBytes` is duplicated 6x across the codebase
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/shared/vector/tabs/documentTabHelpers.ts:6
- **Scenario**: The same B/KB/MB formatter exists in 6 places: here, `settings/sub_portability/components/StorageUsageSection.tsx:10`, `settings/sub_network/components/NetworkDashboard.tsx:54`, `settings/sub_network/components/BundleExportDialog.tsx:515`, `plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx:20`, and `overview/components/health/LogDiskUsageSection.tsx:7` (that one already diverged to accept `bigint`).
- **Root cause**: Each feature hand-rolled its own byte formatter instead of a shared util; there is already a `src/lib/utils/formatters.ts` where it belongs.
- **Impact**: Six copies drift independently (one already has a different signature and could differ in rounding/GB handling), and every new surface adds a seventh.
- **Fix sketch**: Move a single `formatBytes(bytes: number | bigint)` into `src/lib/utils/formatters.ts` (superset signature, add a GB tier while at it), replace the six local definitions with imports, and delete the copy here — `documentTabHelpers.ts` then shrinks to just `truncatePath`.

## 3. `useCredentialNav` fallback returns a fresh object every render, defeating downstream memoization
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/shared/hooks/CredentialNavContext.tsx:66
- **Scenario**: When called outside `CredentialNavProvider`, `useCredentialNav` returns a new object literal (with four fresh function identities) on every render. `useBreadcrumbTrail.ts:200` puts the returned `credentialNav` object in its `useMemo` dependency array, so for any consumer mounted outside the provider the breadcrumb trail memo recomputes on every single render of the chrome — the memo is permanently defeated. Same hazard for `SidebarLevel2`, `useCredentialViewFSM`, and any effect keyed on `navigate`.
- **Root cause**: The no-provider fallback is constructed inline in the hook body instead of being a stable module-level constant.
- **Impact**: Silent memo/effect invalidation on hot app-chrome renders whenever the hook runs outside the provider tree — exactly the case the fallback exists for. Cost is bounded (trail rebuild is cheap) but it nullifies the memoization the callers deliberately added and can retrigger effects that depend on `navigate`.
- **Fix sketch**: Hoist the fallback to a module constant: `const NOOP_NAV: CredentialNavContextValue = { currentKey: 'credentials', setCurrentKey: noop, navigate: noop, setNavigateHandler: noop };` and `return ctx ?? NOOP_NAV;`. Identity becomes stable and all downstream memos hold.

## 4. `DocToolbar` lives in a file named `DocUploadArea.tsx`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/features/vault/shared/vector/tabs/DocUploadArea.tsx:12
- **Scenario**: The file exports only `DocToolbar` (a toolbar of refresh/paste/browse/directory buttons); no `DocUploadArea` component exists anywhere. Anyone searching for the toolbar or navigating by filename lands in the wrong mental model, and `DocumentsTab.tsx:17` imports `DocToolbar from './DocUploadArea'`.
- **Root cause**: The file was repurposed (upload area replaced by a toolbar) without renaming.
- **Impact**: Pure navigation/readability friction; also a small trap for auto context-mapping tools that key on filenames.
- **Fix sketch**: Rename the file to `DocToolbar.tsx` and update the single import in `DocumentsTab.tsx`. Optionally do it alongside finding 2's `documentTabHelpers` shrink since both touch the same tab folder.
