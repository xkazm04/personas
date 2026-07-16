# shared/components [1/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Shared UI & Design System | Files read: 34 | Missing: 0

## 1. Two different shared components both named `EmptyState` with conflicting `EmptyStateVariant` exports
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/components/display/EmptyState.tsx:240 (vs src/features/shared/components/feedback/EmptyState.tsx:101)
- **Scenario**: Both live under `shared/components`, both export `EmptyState` and a type named `EmptyStateVariant`, but the variant sets are disjoint (`'chart' | 'activity' | …` vs `'credentials-need-agents' | 'no-results' | …`) and the prop shapes differ (`heading/description/dominant` vs `title/subtitle/action/glyph`). 7 consumers import the display one, 33 the feedback one — an auto-import or a copy-pasted import path silently picks the wrong component and either fails type-check with a confusing error or renders the wrong empty-state family.
- **Root cause**: Two empty-state primitives evolved independently (dashboard-widget illustrations vs scenario/action empty states) and were never reconciled or at least disambiguated by name.
- **Impact**: Real maintenance hazard in the design-system layer: identical public names for different contracts, duplicated concept (variant map + heading + description resolution exists twice), and no signpost telling a feature author which one to use.
- **Fix sketch**: Minimal, low-risk step: rename the display one to `WidgetEmptyState` (and its variant type to `WidgetEmptyStateVariant`) — only 7 call sites — and add a doc comment in each file pointing at the other. Full consolidation (one component with an `illustration` slot) can be a later dedicated pass; the rename alone removes the collision.

## 2. `GroupedTableBody` duplicates UnifiedTable's keyboard-nav handler and row markup
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/components/display/UnifiedTable.tsx:583
- **Scenario**: The ArrowUp/ArrowDown/Enter/Space `handleKeyNav` callback (lines 383–401) is copied nearly verbatim into `GroupedTableBody` (lines 583–602, differing only in the `flatByData` index mapping), and the virtual row `<div>` markup — style object, accent/focus/zebra className string, per-column cell loop — appears three times in the file (non-grouped virtual ~486, grouped ~630, non-virtual ~507). The file header even claims the grouped path "reuses the shared grouping core", but the row rendering and key handling are re-implemented.
- **Root cause**: The grouped mode was added as an intentionally isolated render path to keep the default branches byte-identical, and the shared parts (key nav, row cell rendering) were copied rather than extracted.
- **Impact**: Any change to row interaction (e.g. Home/End keys, focus-ring styling, accent behavior) must now be made in 2–3 places in a 650-line golden-standard component; the grouped and ungrouped tables will drift.
- **Fix sketch**: Extract a `useTableKeyNav(sortedData, onRowClick, scrollTo: (dataIndex) => void)` hook (the only difference between the two copies is the `scrollTo` mapping) and a small `TableRowCells<T>` component (or a `rowClassName(accent, focused, index)` helper) used by all three branches. Pure extraction, no behavior change.

## 3. FirstUseConsentModal builds Tailwind classes and CSS vars dynamically that don't exist
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/shared/components/overlays/FirstUseConsentModal.tsx:73
- **Scenario**: Opening any consent accordion section applies `` `border-${color}/25 bg-${color}/5` `` (e.g. `border-violet/25 bg-violet/5`) plus `style={{ borderColor: 'var(--color-violet, rgba(100,100,100,0.25))' }}`. Tailwind cannot see interpolated class names at build time (and `bg-violet/5` isn't even a valid utility — a shade is required), and no `--color-violet`-style bare vars are defined in the app (only one unrelated file references such names), so every open section falls back to the same gray `rgba(100,100,100,0.25)` border and gets no background tint at all.
- **Root cause**: Dynamic template-literal class construction, which the codebase elsewhere explicitly avoids (see Button.tsx's static `ACCENT_CLASSES` map with the comment "ensures Tailwind can detect them during purging").
- **Impact**: The per-section color accents are dead code — they never render as designed — and the pattern invites copy-paste of a known Tailwind footgun from a shared, high-visibility component.
- **Fix sketch**: Mirror Button.tsx: define a static `SECTION_OPEN_CLASSES: Record<color, string>` map with literal classes (`'border-violet-500/25 bg-violet-500/5'`, etc.), index it by the `color` prop, and delete the inline `var(--color-…)` style fallback.

## 4. ReasoningTrace re-renders every entry on each streamed event, unmemoized and unvirtualized
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/layout/ReasoningTrace.tsx:188
- **Scenario**: During a live execution, each new reasoning event appends to `entries` and re-renders the whole list: every `EntryRenderer` re-runs (each one calling `useTranslation()`), keyed by array index with no `memo`. Long runs accumulate hundreds of entries (heartbeats alone add one every few seconds), so per-event work grows linearly with run length exactly while the stream is hottest.
- **Root cause**: Plain `entries.map(...)` with `key={i}` and a non-memoized row component; no virtualization despite the sibling TerminalBody already using `@tanstack/react-virtual` for the same live-log shape.
- **Impact**: O(n) reconciliation per streamed event on a hot path; a 500-entry trace does 500 row renders for every heartbeat/tool-call, contributing jank to the execution view while the agent is running.
- **Fix sketch**: Wrap `EntryRenderer` in `React.memo` and key rows by a stable identity (e.g. `entry.ts` + index of first occurrence) so appends only mount the new row — `entry` objects are append-only, so memo hits on all existing rows. If traces routinely exceed ~1k entries, reuse the TerminalBody virtualizer pattern; the memo alone removes the per-event O(n) render cost.

## 5. JsonEditor double-parses the full document and forces a synchronous reflow on every keystroke
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/editors/JsonEditor.tsx:164
- **Scenario**: Each keystroke runs `JSON.parse` over the whole value (validation memo, line 127), a full character-by-character `tokenizeJson` scan (highlight memo, line 140) creating one `<span>` per token, and the auto-resize effect which sets `height='auto'` then reads `scrollHeight` — a forced synchronous layout of the two stacked layers — before writing the height back.
- **Root cause**: Validation, tokenization, and resize are all keyed directly on `value` with no debounce; the resize effect uses the measure-after-reset pattern that guarantees layout thrash per input event.
- **Impact**: Fine for small credential configs, but pasting or editing a multi-KB JSON payload makes every keystroke do 2 full parses + full token-span reconciliation + a forced reflow; typing latency degrades with document size. Bounded because the editor is used for config-sized JSON, hence Low.
- **Fix sketch**: Debounce the validation + highlight memos behind the existing `useDebounce` hook (~150 ms) while leaving the textarea itself uncontrolled-fast, and only re-measure height when `scrollHeight` could have changed (e.g. track line count) or wrap the measurement in `requestAnimationFrame` to avoid the mid-event forced reflow.
