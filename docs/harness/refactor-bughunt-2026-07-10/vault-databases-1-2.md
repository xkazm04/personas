> Context: vault/databases [1/2]
> Total: 10
> Critical: 0  High: 1  Medium: 7  Low: 2

## 1. Redis `TYPE ${key}` interpolates the key name raw into a command string
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src/features/vault/sub_databases/tabs/TablesTab.tsx:37
- **Scenario**: Clicking a Redis key runs `executeDbQuery(credentialId, \`TYPE ${key}\`)`. A key containing a space (`user profile`) produces `TYPE user profile` → wrong-arg-count error, so the detail panel silently shows type `error`. A key containing a newline or CR (`foo\r\nFLUSHALL`) can inject a second command if the backend uses inline/RESP-inline parsing.
- **Root cause**: `introspectionQueries.ts` painstakingly escapes Redis glob metacharacters (`escapeRedisGlob`) for SCAN, but this ad-hoc `TYPE` command bypasses all of that and interpolates the untrusted key name directly. Keys originate from the connected DB (SCAN output), which an attacker who controls the data can influence.
- **Impact**: security (command injection into the user's live Redis) / silent-failure (spaces/binary keys always report `error`).
- **Fix sketch**: Route `TYPE` through the same escaping seam, or better, add a dedicated backend introspection command (like `introspectDbColumns`) that binds the key as an argument rather than string-splicing it.

## 2. NL-query poll has no timeout — a stuck backend locks the chat forever
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: reliability
- **File**: src/features/vault/sub_databases/tabs/ChatTab.tsx:76-105
- **Scenario**: `setInterval` polls `getNlQuerySnapshot` every 800ms and only stops on status `completed`/`failed`. If the backend job stays `pending`/`running` (crash, dropped job, never-updated snapshot), the interval polls indefinitely, `generating` stays `true`, and the input is locked (`handleSubmit` early-returns while generating). The only escape is closing the modal.
- **Root cause**: The polling loop trusts the snapshot to eventually reach a terminal state; there is no elapsed-time or max-attempts guard.
- **Impact**: UX (chat tab wedged, no way to retry without losing session state).
- **Fix sketch**: Track a start time or attempt counter; after e.g. 60s force the assistant message to `failed` with a timeout message, clear the interval, reset `generating`, and cancel the backend job.

## 3. Query result header and body are two independent `<table>`s — columns misalign
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_databases/QueryResultTable.tsx:66-107
- **Scenario**: The sticky header renders in one `<table class="w-full">` (line 67) and the virtualized body in a separate `<table class="w-full">` (line 107). Each table auto-sizes its own columns from its own content, so whenever a data cell is wider/narrower than its header (long values, `max-w-[300px]` truncation, NULL), the header label no longer sits above its column. With many columns the drift is large.
- **Root cause**: Splitting header and body into separate tables to get a sticky header sacrifices shared column-width computation.
- **Impact**: UX (users read values under the wrong column heading — real correctness risk when copying cells).
- **Fix sketch**: Use one table with `position: sticky` on `thead`, or drive both tables from a shared fixed `<colgroup>`/`table-layout: fixed` with explicit per-column widths.

## 4. Saving an edited query swallows failures silently
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:54-64
- **Scenario**: `handleSave` does `try { await updateQuery(...); setSaveState('saved') } catch { setSaveState('idle') }`. If the persist call fails (DB locked, credential deleted, IPC error), the button just returns to its resting state with no toast and no "saved" confirmation. A user who glances away assumes the edit persisted; it did not.
- **Root cause**: Empty catch that only resets local UI state, discarding the error. Notably `SchemaManagerModal.saveName` in this same context was deliberately upgraded to surface errors via `toastCatch`, so this is an inconsistency.
- **Impact**: data loss (edited query text lost without warning).
- **Fix sketch**: In the catch, call `toastCatch('QueryEditorPane:handleSave', ...)(err)` and consider keeping the editor dirty/unsaved so the user can retry.

## 5. Rapid table selection can display columns from the wrong table
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/vault/sub_databases/tabs/TablesTab.tsx:43-46 (via useTableIntrospection.fetchColumns)
- **Scenario**: `handleSelectTable` sets `selectedTable` synchronously and calls `fetchColumns(tableName)`. `fetchColumns` (useTableIntrospection.ts:190) has no generation guard — if the user clicks table A then B before A's introspection resolves, A's late response calls `setColumns(A)` last, so the panel shows A's columns while B is highlighted. `ConsoleTab` guards exactly this with `queryGenRef`, but the column fetch does not.
- **Root cause**: `setColumns` is written unconditionally on resolve; nothing ties the response to the currently-selected table.
- **Impact**: UX / correctness (wrong schema shown for the selected table on slow connections).
- **Fix sketch**: Add a monotonically increasing ref (or capture `tableName` and compare against the latest selection) before applying `setColumns`; drop stale responses.

## 6. Dead production code: three SQL query-builders are only exercised by their own tests
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/vault/sub_databases/introspectionQueries.ts:31-43, 88-112
- **Scenario**: `getListTablesQuery`, `getListColumnsQuery`, and `getRedisKeyScanCommand` are exported but the only importers are `introspectionQueries.test.ts`. Real introspection runs in the Rust backend via `introspectDbTables`/`introspectDbColumns` (useTableIntrospection.ts). Verified with grep: no production caller. Only `getSelectAllQuery` (clipboard) and `getConnectorFamily`/`isApiFamily` are live.
- **Root cause**: Introspection moved to Rust; the TS query builders (and their SQL-escaping) were left behind, kept green by tests.
- **Impact**: maintainability + security-drift risk (a future dev may "fix" escaping here believing it's what runs against the DB, when the real query lives in Rust and can silently diverge).
- **Fix sketch**: Delete the three unused builders and their tests, or add a comment/re-point them so the escaping contract has one source of truth. Keep `escapePostgresIdent`/`escapeMysqlIdent`/`escapeRedisGlob` (used by `getSelectAllQuery`).

## 7. serviceType→dialect mapping is duplicated across three functions
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/introspectionQueries.ts:3-24; SchemaManagerModal.tsx:220-236; tabs/ChatTab.tsx:186-193
- **Scenario**: `getConnectorFamily` (family), `getQueryLanguage` (editor language), and `getDatabaseType` (NL-query dialect) each `switch (serviceType)` over the same connector list with slightly different outputs. Adding a new connector (e.g. `mongodb` already handled inconsistently — it's a language but maps to `unsupported` family) requires editing three places and it's easy to miss one.
- **Root cause**: Three parallel mappings grew independently instead of deriving language/dialect from the single `ConnectorFamily`.
- **Impact**: maintainability (silent inconsistency across surfaces for the same connector).
- **Fix sketch**: Make `getConnectorFamily` canonical and derive `queryLanguage`/`dbType` from the family via small lookup maps in `introspectionQueries.ts`; delete the two local copies.

## 8. Mutation-confirmation dialog JSX duplicated between ConsoleTab and QueryEditorPane
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:127-157; tabs/QueryEditorPane.tsx:125-155
- **Scenario**: Both files render a ~30-line amber "modifies data" confirmation panel — same AlertTriangle, `db.modifies_data`, the `pendingMutation.length > 200 ? slice(0,200)+'...'` preview, and Execute-anyway/Cancel buttons. They differ only in a margin class and `modifies_data_hint` vs `modifies_data_hint_short`. Both are driven by the same `useQuerySafeMode` hook.
- **Root cause**: Copy-paste when the second tab adopted safe mode; no shared component.
- **Impact**: maintainability (edits/a11y fixes must be made twice and can drift).
- **Fix sketch**: Extract `<MutationConfirmDialog pendingMutation onConfirm onCancel hint />` next to `useQuerySafeMode` and use it in both tabs.

## 9. `DatabaseListView` receives an `onBack` prop it never uses
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_databases/DatabaseListView.tsx:17
- **Scenario**: The prop is destructured as `{ onBack: _onBack }` and never referenced anywhere in the component. The underscore rename confirms it was intentionally silenced rather than used.
- **Root cause**: Leftover from an earlier navigation design; the parent still passes a callback that goes nowhere.
- **Impact**: maintainability (dead prop obscures the real navigation contract; callers wire up a no-op).
- **Fix sketch**: Remove `onBack` from `DatabaseListViewProps` and the destructure, and drop the argument at the call site — or actually wire a back button if one was intended.

## 10. `renderCell` and `formatCell` are near-duplicate cell serializers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/vault/sub_databases/QueryResultTable.tsx:195-206
- **Scenario**: `renderCell` (display) and `formatCell` (copy/aria-label) both map NULL→`'NULL'` and objects→`JSON.stringify`, differing only in boolean handling and JSON indentation. They're called in tandem on every cell; the subtle divergence (boolean rendered as `true`/`false` in one, via `String()` in the other) is easy to break unnoticed.
- **Root cause**: Two formatters written separately for two consumers with mostly-overlapping rules.
- **Impact**: maintainability (low).
- **Fix sketch**: Collapse into one `formatCell(cell, { pretty?: boolean })` and derive the display string from it; keep the pretty flag for copy.
