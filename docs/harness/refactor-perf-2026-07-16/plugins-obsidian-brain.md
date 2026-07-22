# plugins/obsidian-brain — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Plugins & Companion | Files read: 20 | Missing: 0

## 1. BrowsePanel tree filter re-walks every subtree at every node on every keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: expensive-recomputation
- **File**: src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:20 (used at :34, :37, :40)
- **Scenario**: User types in the "filter notes" box on a vault with thousands of notes. Every keystroke re-renders every `TreeItem`, and each `TreeItem` calls the recursive `matchesFilter(node, filter)` up to three times (initial-state expression on line 34, the expand effect on line 37, and the render guard on line 40), each call walking that node's entire subtree with `toLowerCase()` per visit.
- **Root cause**: The match decision is computed per-node from scratch instead of once per (tree, filter). Summed over all nodes the work is O(n × depth) per render pass — and the effect on line 37 triggers a second render pass when it expands nodes — with no debounce on the input.
- **Impact**: On large vaults (Obsidian vaults with 5–10k notes are common) each keystroke does tens of thousands of redundant subtree visits and string lowercase allocations, producing visible input lag exactly on the hot interactive path.
- **Fix sketch**: In `BrowsePanel`, `useMemo` a single traversal per (tree, filter) that produces a `Set<string>` of visible paths (a node is visible if it or any descendant matches); pass `visiblePaths` down to `TreeItem` and replace all three `matchesFilter` calls with O(1) set lookups. Optionally debounce the filter state by ~150ms. This turns per-keystroke cost from O(n·depth·3) to a single O(n) walk.

## 2. Revitalize log streaming re-renders the entire RevitalizePanel per output line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/obsidian-brain/sub_revitalize/useRevitalizeJob.ts:70 (consumed at RevitalizePanel.tsx:23)
- **Scenario**: A revitalize pass streams `OBSIDIAN_REVITALIZE_OUTPUT` events (LLM narration can emit many lines per second). Each event sets `lines` state inside `useRevitalizeJob`, which lives in `RevitalizePanel` — so every streamed line re-renders the whole panel: the SectionCard with three SettingRows, the instructions textarea, `RevitalizeHistoryTable` (20-row table), and `SavedConfigsSidebar`, plus all 200 unmemoized `<p>` log lines in `RevitalizeProgress`.
- **Root cause**: Panel-wide state ownership for data only `RevitalizeProgress` consumes; none of the sibling components are memoized against the churning `lines` array.
- **Impact**: Sustained whole-subtree reconciliation for the duration of a job (minutes), burning CPU in the webview while the user may be typing in the instructions field or interacting elsewhere on the page.
- **Fix sketch**: Move the `lines` state (and the OUTPUT listener) out of `useRevitalizeJob` into `RevitalizeProgress` itself, keyed by `jobId` — the hook already exposes `running`/`summary`/`error` separately, and `RevitalizeProgress` can seed from `obsidianRevitalizeSnapshot`. Alternatively `React.memo` the history table + sidebar and memoize the log rows; the state move is cleaner.

## 3. "No vault connected" empty state duplicated verbatim across all five panels
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:148 (also SyncPanel.tsx:171, GraphPanel.tsx:178, CloudSyncPanel.tsx:135, RevitalizePanel.tsx:30)
- **Scenario**: Any styling or behavior change to the disconnected state (icon, tone, the "go to Setup" action) must be applied in five places; the copies have already started drifting (CloudSyncPanel uses `no_vault_cloud_hint` while the rest use `no_vault_hint`, and wrapper classNames vary slightly).
- **Root cause**: The 12-line `EmptyState` block — amber `AlertTriangle`, identical `iconColor`/`iconContainerClassName`, identical `setObsidianBrainTab('setup')` action — was copy-pasted into each tab panel instead of extracted.
- **Impact**: ~60 lines of pure duplication and a real drift hazard in a feature that clearly cares about consistent styling; each panel also re-imports `AlertTriangle`/`Settings`/`EmptyState` just for this.
- **Fix sketch**: Add `src/features/plugins/obsidian-brain/NoVaultConnected.tsx` taking an optional `subtitle` (default `no_vault_hint`), rendering the wrapper div + EmptyState + setup action. Replace the five blocks with `if (!connected) return <NoVaultConnected />` (CloudSyncPanel passes its cloud-specific hint). Net −50 LOC and one source of truth.

## 4. Hardcoded English toasts/labels inside an otherwise fully-localized feature
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx:83 (also BrowsePanel.tsx:106,190,236; GraphPanel.tsx:78,119,127,137-138,144,152,166,172; SyncPanel.tsx:109,112,137,144,150; CloudSyncPanel.tsx:85,98-99,108,122-123,127,153,292-296)
- **Scenario**: A user running the app in any of the 14 shipped locales (cs, ja, zh, …) sees fully translated panels, then English-only toasts ("Drive push failed: …", "Write something to capture first", "Meeting note saved: …"), loading labels ("Loading vault...", "Checking Drive connection..."), and result words ("uploaded"/"downloaded"/"skipped").
- **Root cause**: These panels mix `t.plugins.obsidian_brain.*` lookups with raw English template literals — roughly 25 user-facing strings never went through the i18n catalog (the codebase even has a `DebtText` mechanism for tracking exactly this).
- **Impact**: Visible localization drift on the most attention-grabbing surface (toasts and error messages), and the strings are invisible to the catalog parity check so the gap won't self-heal.
- **Fix sketch**: Move each literal into `plugins.obsidian_brain` keys (with `tx` placeholders for counts/errors) or wrap in `DebtText` where the debt workflow is preferred. The sync/pull result toasts in SyncPanel/CloudSyncPanel share a shape ("X created, Y updated, Z skipped, N errors") and can consolidate to one `tx` key per direction.

## 5. formatDuration duplicated twice in-context while a shared formatter module exists
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/obsidian-brain/sub_revitalize/RevitalizeSummaryCard.tsx:13 (identical copy at RevitalizeHistoryTable.tsx:17)
- **Scenario**: The two Revitalize components each define a byte-identical `formatDuration(secs)`; a format tweak (e.g. show hours for long passes) must be made twice or the summary card and history table disagree.
- **Root cause**: Helper defined inline per-file instead of once; `src/lib/utils/formatters.ts:407` already exports a `formatDuration`, and `CloudSyncPanel.tsx:20` similarly re-implements `formatBytes` that exists at `src/features/vault/shared/vector/tabs/documentTabHelpers.ts:6` (and 4 other private copies app-wide).
- **Impact**: Small but concrete drift risk; also adds to the app-wide pile of 6 `formatBytes` / 3 `formatDuration` implementations.
- **Fix sketch**: Extract one `formatDuration` into a small `sub_revitalize/format.ts` (or reuse/extend the `lib/utils/formatters.ts` export if its signature fits seconds) and import it in both components; have CloudSyncPanel import the shared `formatBytes` from `documentTabHelpers` or a lib-level home. Verify the lib `formatDuration` signature before swapping (it may take ms).
