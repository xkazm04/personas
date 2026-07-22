# vault/databases [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Mutation-confirmation banner and safe-mode toggle duplicated across Console and Query Editor
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:128 (dup of tabs/QueryEditorPane.tsx:126)
- **Scenario**: Any change to the "this query modifies data" confirmation UX (copy, truncation length, button styling, a11y) must be made twice; the two copies are already drifting (`modifies_data_hint` vs `modifies_data_hint_short`). The safe-mode Shield/ShieldOff toggle button is a third near-identical block (ConsoleTab.tsx:95-107 vs QueryToolbar.tsx:75-86).
- **Root cause**: Both tabs consume the same `useQuerySafeMode` hook but each re-implements the ~30-line pendingMutation banner JSX and the toggle button inline instead of sharing a component.
- **Impact**: ~60 lines of copy-pasted safety-critical UI; a fix applied to one surface (e.g. the 200-char SQL preview, focus handling) silently misses the other.
- **Fix sketch**: Extract `MutationConfirmBanner({ pendingMutation, onConfirm, onCancel, hint })` and `SafeModeToggle({ safeMode, onToggle, compactLabels })` into `sub_databases/tabs/` (or next to `useQuerySafeMode`), render them from both ConsoleTab and QueryEditorPane/QueryToolbar. Pure JSX extraction, no behavior change.

## 2. serviceType → dialect mapping triplicated (getConnectorFamily / getQueryLanguage / getDatabaseType)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_databases/SchemaManagerModal.tsx:220 (also introspectionQueries.ts:3, tabs/ChatTab.tsx:186)
- **Scenario**: Adding a new connector (e.g. `turso`, `cockroachdb`) requires updating three independent switch statements over the same `service_type` values; missing one gives inconsistent behavior per tab (introspection works but chat generates generic "sql", etc.).
- **Root cause**: `getConnectorFamily` (introspectionQueries.ts) is the canonical mapping, but `getQueryLanguage` in SchemaManagerModal.tsx and `getDatabaseType` in ChatTab.tsx re-enumerate the same service types with slightly different output vocabularies. They are already diverging: `getDatabaseType` knows nothing about `notion`/`airtable`/`convex` (falls through to 'sql' for the NL-query engine) while `getQueryLanguage` handles them.
- **Impact**: Real drift hazard on every connector addition; three sources of truth for one concept.
- **Fix sketch**: Derive both from `getConnectorFamily`: add `queryLanguageForFamily(family)` and `nlDialectForFamily(family)` helpers in introspectionQueries.ts (family → 'redis'|'mongodb'|... and family → 'postgresql'|'mysql'|...), delete the two local switches, and pass family down where already available (TablesTab already receives it).

## 3. Chat NL-query payload grows unbounded with conversation length
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/vault/sub_databases/tabs/ChatTab.tsx:45
- **Scenario**: A user iterating on queries in a long chat session: every `handleSubmit` calls `buildConversationHistory()` which maps the ENTIRE message list — each assistant turn re-embedding its full generated SQL in a fenced block — and ships it to the LLM backend via `startNlQuery`.
- **Root cause**: No cap or windowing on `messages` when building `ConversationTurn[]`; history is cumulative for the lifetime of the (keep-mounted) tab, and the modal keeps ChatTab mounted across tab switches so it never resets until the modal closes.
- **Impact**: Per-request payload and LLM token cost grow linearly with turns; late-session requests get slower and more expensive, and can eventually blow the model context window, failing generation.
- **Fix sketch**: Slice the history to the last N turns (e.g. 8-10) in `buildConversationHistory`, and truncate embedded SQL beyond a few hundred chars per turn. One-line `messages.slice(-N)` before the existing filter/map preserves recency-relevant context.

## 4. QueryResultTable formats every visible cell twice per render on the scroll hot path
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_databases/QueryResultTable.tsx:142
- **Scenario**: Scrolling a result set with JSON/object columns: `@tanstack/react-virtual` re-renders the virtual rows on every scroll frame, and each `<td>` calls `formatCell(cell)` twice (aria-label at :142 and title at :150) plus `renderCell(cell)` — `formatCell` does `JSON.stringify(cell, null, 2)` on object cells.
- **Root cause**: Cell formatting is computed inline in JSX with no per-cell memoization, and duplicated for the two attributes.
- **Impact**: For ~15 visible rows x wide columns, that is dozens of redundant pretty-print stringifies per scroll frame — visible scroll jank exactly on result sets where the tool matters (JSONB/object columns). Plain scalar sets are cheap, so cost is bounded but concentrated on the worst case.
- **Fix sketch**: Compute `const formatted = formatCell(cell)` once per cell and reuse for aria-label/title; optionally extract a memoized `<ResultCell>` (React.memo keyed on cell/copied state) so unchanged cells skip re-render during scroll. Also note rows are fixed-height (ROW_HEIGHT), so `measureElement` on each row is unnecessary and can be dropped.

## 5. Hardcoded English strings in ChatTab bypass the i18n layer used everywhere else
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/vault/sub_databases/tabs/ChatTab.tsx:87
- **Scenario**: Non-English locale users see 'Query generated.', 'Query generation failed.', 'Cancelled.' (:126), the Cancel button title in ChatMessages.tsx:74, and the English-only suggestion prompts from `getSuggestions` (:195), while the rest of the feature is fully translated via `t.vault.databases`.
- **Root cause**: Fallback/status strings were added inline instead of through `useTranslation`, unlike every sibling file in this context.
- **Impact**: Inconsistent localization in one of the most user-facing flows of the schema manager; invisible in English dev testing.
- **Fix sketch**: Add `query_generated`, `query_generation_failed`, `cancelled`, `cancel`, and suggestion keys to `t.vault.databases`, and thread `t` into the status updates and `getSuggestions` (make it take the translation object or move suggestions into the catalog).
