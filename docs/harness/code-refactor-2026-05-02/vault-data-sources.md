# Code Refactor Scan — Vault Data Sources & Dependencies

> Scanned: 2026-05-02 | Findings: 9 | Files reviewed: ~26

## Summary

The two contexts have very different cleanliness profiles. `sub_databases/` is a busy area with many small components and three near-identical scaffolds (Console / Queries editor / Chat tab) that share copy-pasted blocks (mutation confirmation dialog, error formatter, query result containers). The dominant patterns I observed: (1) drift between two siblings that do almost the same thing — `ConsoleOutput`/`ResultsTable`, `TestConnectionButton`/`SidebarTestConnection`, two copies of `extractErrorMessage`; (2) UI subcomponents grouped under a `tabs/` folder even when they aren't tabs, blurring boundaries; (3) one feature (`DatabaseCard`) that survives only via its own tests. `sub_dependencies/` is leaner but ships a large dead branch: revocation simulation pretends to analyse workflows but is always called with `workflows: []`, so the `'critical'` severity, `AffectedWorkflows` UI, and the `mitigation_pause` rule cannot fire in production.

## 1. Revocation simulator's workflow analysis is dead — always called with `[]`

- **Severity**: high
- **Category**: dead-code
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:86 + src/features/vault/sub_dependencies/credentialGraph.ts:255-356
- **Scenario**: `simulateRevocation` accepts a `workflows: Workflow[]` parameter and contains a 17-line block (lines 297-314) that builds `affectedWorkflows`, plus a severity-promotion to `'critical'` when any workflow breaks. The only call site passes `[]`, so this entire path is unreachable. `SimulationResult.totalAffectedWorkflows` is therefore always 0; the `AffectedWorkflows` panel always renders null; the `'critical'` styling/translation key (`severity_critical`, `sim_critical`) and the `mitigation_pause` rule in `MitigationSummary` cannot fire.
- **Root cause**: Workflow integration was scaffolded ahead of the runtime that would supply workflows, and was never wired up. There is no comment indicating it is "coming soon" — this looks like abandoned ground-work, not staged rollout.
- **Impact**: Misleads readers into thinking the simulator is workflow-aware. Translators have shipped four sim_critical/workflows_*/mitigation_pause strings that never display. The `Workflow` type import + unused branch carry maintenance cost.
- **Fix sketch**:
  - Either wire it up (pass real workflows from a store) OR delete the workflow branch entirely.
  - If deleting: drop the `workflows` parameter, the `AffectedWorkflows` component + its translation keys, the `'critical'` severity branch in `SEVERITY_STYLES`, `SimulationPanel.tsx:67-79` (sim_critical block), and the `mitigation_pause` clause.

## 2. `extractErrorMessage` duplicated locally in `ConsoleTab`

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:11-19
- **Scenario**: `ConsoleTab` re-defines `extractErrorMessage` byte-for-byte with the version exported from `../safeModeUtils.ts`. `QueryEditorPane` and `ChatTab` already import the shared one — only `ConsoleTab` is out of step.
- **Root cause**: The util was likely extracted to `safeModeUtils` later and the original local copy in `ConsoleTab` was missed.
- **Impact**: Two implementations to drift; if the JSON-fallback or "error" key is ever changed, `ConsoleTab` will silently produce different error strings than its sibling editors.
- **Fix sketch**:
  - Delete the local `extractErrorMessage` function (lines 11-19).
  - Add `import { extractErrorMessage } from '../safeModeUtils';`.

## 3. `TestConnectionButton` and `SidebarTestConnection` are the same component twice

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/TableActions.tsx:6-44 + src/features/vault/sub_databases/tabs/TableSearch.tsx:52-89
- **Scenario**: Two near-identical components that wrap `useCredentialHealth` to render a "Test connection" button + result chip. Differences are cosmetic only: padding (`px-4 py-2` vs `px-3 py-1.5`), icon size (`w-3.5 h-3.5` vs `w-3 h-3`), result max-width, and using `typo-body`/`typo-caption`. Same logic, same hook, same translation strings.
- **Root cause**: Sidebar variant was copy-forked when a smaller layout was needed instead of parameterising the original.
- **Impact**: Two places to fix bugs (e.g., a11y, error-state changes). The "compact" variant has already drifted on `rounded-modal` vs `rounded-card`.
- **Fix sketch**:
  - Add `size?: 'default' | 'compact'` (or `'sm'`) prop to a single `TestConnectionButton`.
  - Switch sizing tokens off the prop; keep behaviour identical.
  - Update `TableListSidebar.tsx:83,93` to use `<TestConnectionButton size="compact" credentialId={...} />`. Delete `SidebarTestConnection`.

## 4. `ConsoleOutput` and `ResultsTable` render the same four-state container

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/ConsoleOutput.tsx + src/features/vault/sub_databases/tabs/ResultsTable.tsx
- **Scenario**: Both components render the cartesian (error | result | empty | executing) view around `<QueryResultTable result={...} />`. `ResultsTable` adds an `animate-fade-slide-in` and a custom emerald ping; `ConsoleOutput` uses `LoadingSpinner` and gates the empty hint on `pendingMutation`. Otherwise identical structure, identical `flex-1 min-h-0 overflow-y-auto`, identical translation keys (`db.executing_query`, `db.redis_*_hint`, `db.sql_*_hint`).
- **Root cause**: ConsoleTab and the saved-query editor each produced a results panel side-by-side and never converged.
- **Impact**: Two layout shells with the same job. Adding (e.g.) a row-count tag means changing both. The `redis_hint`/`redis_run_hint` and `sql_hint`/`sql_run_hint` translation pairs exist purely to feed the duplicate.
- **Fix sketch**:
  - Extract a shared `<QueryResultPanel result error executing language hint?: 'idle' | 'mutation-pending' />` (or accept a `hideEmptyState` boolean for the mutation case).
  - Collapse the `redis_hint`/`redis_run_hint` and `sql_hint`/`sql_run_hint` translation duplicates into one each.

## 5. Mutation-confirmation dialog block copy-pasted between `ConsoleTab` and `QueryEditorPane`

- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:137-166 + src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:125-154
- **Scenario**: ~30 lines of identical JSX render the amber "modifies data" warning, the truncated SQL `<pre>`, and the Confirm/Cancel buttons. The only divergence: `db.modifies_data_hint` vs `db.modifies_data_hint_short` and an outer-margin tweak (`mx-4 mb-3` vs `mx-4 mt-2`).
- **Root cause**: `useQuerySafeMode` was extracted but the matching UI was not.
- **Impact**: Any visual or copy update has to be made twice. Already drifting on the hint-string and margin.
- **Fix sketch**:
  - Co-locate a `<MutationConfirmDialog pendingMutation onConfirm onCancel hint?: 'short' | 'long' className?>` next to `useQuerySafeMode` (e.g. `hooks/useQuerySafeMode.tsx`).
  - Replace both call-site blocks with the component.

## 6. `DatabaseCard` is dead in production — only its own test references it

- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/vault/sub_databases/DatabaseCard.tsx + __tests__/DatabaseCard.test.tsx
- **Scenario**: `DatabaseCard` is an entire 62-line button component (icon, name, badges) with no production importers. Project-wide grep returns only `DatabaseCard.test.tsx` (7 invocations). The actual list view (`DatabaseListView`) renders a `DataGrid` with `useDbGridColumns` instead.
- **Root cause**: Likely the original card-based UI before migration to the data-grid view; the component and its 100-line test survived the cutover.
- **Impact**: ~160 lines of source + tests with zero runtime value. The test still runs in CI, slowing every test suite slightly and making future contributors wonder which is the canonical view.
- **Fix sketch**:
  - Delete `DatabaseCard.tsx` and `__tests__/DatabaseCard.test.tsx`.
  - If a future grid card is needed, restore from git.

## 7. Dead exports in `graphConstants.ts` and `introspectionQueries.ts`

- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_dependencies/graphConstants.ts:11-16 + src/features/vault/sub_databases/introspectionQueries.ts:101-103
- **Scenario**: Two exports with no consumers: (a) `KIND_LABELS` (the static, English-only fallback) — every component already uses `getKindLabels(t)`; the comment even tells readers not to use the static one. (b) `getRedisKeyScanCommand()` returning `'SCAN 0 MATCH * COUNT 100'` — never imported (`useTableIntrospection` builds its own SCAN).
- **Root cause**: Static label was kept as a "for tests / fallback" convenience that was never adopted; `getRedisKeyScanCommand` looks like an early helper that lost out to inlined logic.
- **Impact**: Misleading discoverability — a reader looking at constants will think `KIND_LABELS` is the source of truth. Dead exports survive every refactor because TS-prune isn't enforced.
- **Fix sketch**:
  - Delete `KIND_LABELS` and the misleading comment.
  - Delete `getRedisKeyScanCommand` (or make it package-private — but better to drop).

## 8. `DatabaseListView` accepts `onBack` but never uses it (renamed to `_onBack`)

- **Severity**: low
- **Category**: cleanup
- **File**: src/features/vault/sub_databases/DatabaseListView.tsx:11-17 + src/features/vault/sub_credentials/manager/CredentialAddViews.tsx:117
- **Scenario**: The view's only prop is destructured as `onBack: _onBack` to mute the unused-vars lint. The single caller still passes `() => dispatch({ type: 'GO_LIST' })`. There is no in-component back affordance — the back UX lives in the parent dispatcher now.
- **Root cause**: Back button was probably owned by the view originally and migrated up to the parent without removing the prop wiring.
- **Impact**: Dead prop noise; new maintainers waste cycles tracing where `onBack` should fire.
- **Fix sketch**:
  - Drop the `onBack` prop and the `DatabaseListViewProps` interface (or replace with `unknown`/no props).
  - Remove the `onBack={() => dispatch(...)}` at the call site.

## 9. `tabs/` folder contains non-tab subcomponents — boundary blur

- **Severity**: low
- **Category**: structure
- **File**: src/features/vault/sub_databases/tabs/
- **Scenario**: The folder name implies "the four `*Tab.tsx` modal tabs," but it also holds tab-internal subcomponents that have nothing to do with tab switching: `TableContextMenu.tsx`, `TableSearch.tsx` (which exports an unrelated `SidebarTestConnection`), `ConsoleOutput.tsx`, `ResultsTable.tsx`, `AssistantSqlBlock.tsx`, `ChatMessages.tsx`, `ChatInput.tsx`, `ColumnList.tsx`, `QueryToolbar.tsx`, `TableActions.tsx`, `TableListSidebar.tsx`, `TableDetailPanel.tsx`. Sibling components like `SqlEditor.tsx` and `QueryResultTable.tsx` live one level up at `sub_databases/`, with no clear rule for which side of the boundary a new helper belongs on.
- **Root cause**: The folder grew incrementally as each tab was decomposed; the name was never re-evaluated.
- **Impact**: New contributors guess wrong about where to add a helper. Imports leak `../` and `./` indiscriminately. Hard to tell at a glance which files are the four entry-point tabs.
- **Fix sketch**:
  - Either rename `tabs/` → `components/` (matches `sub_dependencies/` style) and let any vault-databases UI live there
  - Or split into `tabs/` (just `*Tab.tsx`) + `components/{chat,console,queries,tables}/` per-tab subfolders. Pick one and document it.
  - Smaller cheap win: keep `tabs/` but extract `SidebarTestConnection` out of `TableSearch.tsx` and merge with `TestConnectionButton` (see finding 3).

> Total: 9 findings (1 high, 5 medium, 3 low)
