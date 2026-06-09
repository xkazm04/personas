# UI Perfectionist — mcp-tools-gateways-knowledge-base
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. SQL result grid is mouse-only — cells/columns copy on click with no keyboard or screen-reader access
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/vault/sub_databases/QueryResultTable.tsx:62-83, 121-132
- **Scenario**: A keyboard user runs a query, gets a result grid, and can do nothing with it. The core interaction — click a header to copy the column name, click a cell to copy its value — is bound to `onClick` on bare `<th>`/`<td>` elements with no `tabIndex`, no `onKeyDown`, no `role="button"`, and no `aria-label`. Screen readers announce static table cells; there is no hint they are interactive or that activation copies text. The `cursor-pointer` + `hover:bg` styling promises interactivity that assistive tech can't reach.
- **Root cause**: Copy affordance was layered onto semantic table cells instead of focusable controls; no keyboard handler or ARIA was added. The copy-confirmation (`Check` + "copied") is also purely visual with no `aria-live`, so non-sighted users get no feedback even if they could trigger it.
- **Impact**: inaccessible
- **Fix sketch**: Make each interactive `<th>`/`<td>` keyboard-reachable: add `tabIndex={0}`, `role="button"`, `onKeyDown` handling Enter/Space → same copy handler, and a descriptive `aria-label` (e.g. `tx(db.click_copy_cell, …)`). Wrap the copied-confirmation text in an `aria-live="polite"` region (a single visually-hidden live region updated on copy is enough) so the "Copied" state is announced. Keep the existing visual styling.

## 2. Three divergent re-implementations of the result / error / empty / loading output block
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/vault/sub_databases/tabs/ResultsTable.tsx:16-43, src/features/vault/sub_databases/tabs/ConsoleOutput.tsx:17-46, src/features/vault/sub_databases/tabs/AssistantSqlBlock.tsx:62-87
- **Scenario**: The same conceptual panel — "show the query error, else the result table, else an empty hint, else an executing spinner" — is hand-rolled three times across the Queries pane, the Console pane, and the chat SQL block, and each looks different. The Queries pane shows a polished pulsing-dot "Executing query" indicator; the Console shows a plain `LoadingSpinner` + text; the chat block shows a `Loader2` spin. Error rendering diverges too (see finding #3). A user moving between the Console and Queries tabs of the *same* database sees two different treatments of identical states.
- **Root cause**: No shared `QueryOutput` (or `QueryResultPanel`) component; each consumer wires `result`/`error`/`executing` props into its own JSX, so states drift independently and gain/lose polish per file.
- **Impact**: inconsistency
- **Fix sketch**: Extract a single `QueryOutput({ result, error, executing, emptyHint, language })` that owns the error banner, `QueryResultTable`, empty hint, and the loading indicator, then render it from all three call sites. Pick the pulsing-dot executing indicator as the canonical one.

## 3. Query errors are styled two different ways — a shared banner in one pane, a raw red box in others
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/vault/sub_databases/tabs/ResultsTable.tsx:18-20, src/features/vault/sub_databases/tabs/ConsoleOutput.tsx:19-23, src/features/vault/sub_databases/tabs/AssistantSqlBlock.tsx:79-83
- **Scenario**: The same database error message appears in a designed `InlineErrorBanner` (icon, structure, animation) in the Queries pane, but as a bare `bg-red-500/10 border border-red-500/20 typo-code … font-mono` `<div>` with no icon and no heading in the Console pane and the chat SQL block. The same failure feels like a polished product in one tab and a debug dump in the next.
- **Root cause**: `InlineErrorBanner` exists and is used once, but the other two error surfaces were written inline before/around it and never migrated, so there is no single error presentation.
- **Impact**: inconsistency | error-blind
- **Fix sketch**: Route all three error states through `InlineErrorBanner` (it already lives at `@/features/shared/components/feedback/InlineErrorBanner`). If a monospace error body is desired for SQL engine output, add a `mono`/`variant` prop to the banner rather than forking the markup. Folds naturally into the extraction in finding #2.

## 4. Placeholder text renders at full foreground strength — indistinguishable from real input
- **Severity**: high
- **Category**: visual-hierarchy
- **File**: src/features/vault/sub_databases/SqlEditor.tsx:72, src/features/vault/sub_databases/tabs/QuerySidebar.tsx:57, src/features/vault/shared/vector/tabs/SearchTab.tsx:76
- **Scenario**: The SQL editor's `SELECT * FROM ...` hint, the new-query title input, and the KB search box all use `placeholder:text-foreground`. The placeholder is painted in the same full-strength color as typed text, so an empty editor looks like it already contains the query `SELECT * FROM ...` — a user may hit Run on a "ghost" query, or not realize the field is empty. (Confirmed 20 occurrences of `placeholder:text-foreground` across the vault surface, while the rest of the app correctly uses `placeholder:text-muted`.)
- **Root cause**: Placeholder color was set to `text-foreground` instead of a muted token; the placeholder pseudo-element therefore has no visual de-emphasis distinguishing it from entered content.
- **Impact**: confusion | unpolished
- **Fix sketch**: Replace `placeholder:text-foreground` with `placeholder:text-muted-foreground/50` (the pattern already used elsewhere in the codebase) on these inputs/textarea. Also add an `aria-label` (e.g. "SQL query editor") to the `SqlEditor` `<textarea>` (line 64) — it currently has only a placeholder for an accessible name and the highlight layer is `aria-hidden`.

## 5. NULL result cells look identical to a literal string "NULL"
- **Severity**: medium
- **Category**: polish
- **File**: src/features/vault/sub_databases/QueryResultTable.tsx:118-129, 173-177
- **Scenario**: A SQL NULL renders as the text `NULL` in `text-foreground italic` — but a row whose actual value is the *string* `'NULL'` (returned by `renderCell` as `NULL`, non-italic) is visually almost identical. Italic alone is a weak, easily-missed differentiator, and the cell color (`text-foreground`) is the same as every real value. Distinguishing a real null from a text value is exactly what an analyst inspecting query output needs.
- **Root cause**: Null styling relies on a single subtle cue (italic) and reuses full-strength foreground; there is no dedicated muted/badge treatment for the null sentinel.
- **Impact**: error-blind | unpolished
- **Fix sketch**: Render NULL with a clearly distinct muted token (e.g. `text-muted-foreground/50 italic` or a small `NULL` pill) so it reads as "absence of value" rather than "the word NULL". Apply the same treatment to the `-` default-value placeholder in ColumnList for consistency.

## 6. Empty states are split between the polished EmptyIllustration and bespoke hand-rolled blocks
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/vault/sub_databases/tabs/QuerySidebar.tsx:111-118, src/features/vault/sub_databases/tabs/QueriesTab.tsx:52-59, src/features/vault/sub_databases/tabs/TableDetailPanel.tsx:123-142, src/features/vault/sub_databases/tabs/ColumnList.tsx:42-48
- **Scenario**: Within the same Database modal, some empty states use the designed `EmptyIllustration` component (the DB list, KB search, KB documents, and the "no rows" result all do), while sibling panels invent their own: QuerySidebar's "no saved queries" uses a 10×10 icon tile, QueriesTab's "select or create" uses a 12×12 tile, TableDetailPanel uses a bare 6×6 icon with no tile, and ColumnList's "no columns" is plain centered text with no icon at all. Icon sizes, container chrome, and spacing all differ, so emptiness feels inconsistent as the user clicks around tabs.
- **Root cause**: `EmptyIllustration` is the established shared empty-state primitive but wasn't adopted uniformly; each panel grew its own ad-hoc empty block.
- **Impact**: inconsistency | unpolished
- **Fix sketch**: Replace the four bespoke empty blocks with `EmptyIllustration` (icon + heading + description), matching the patterns already used in DatabaseListView/SearchTab/DocumentsTab. This unifies icon sizing, tile treatment, and vertical rhythm across every empty surface in the explorer.
