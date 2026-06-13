> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

# agent-memories-knowledge — UI Perfectionist findings (2026-06-13)

Scope: `src/features/overview/sub_memories/**` and `src/features/overview/sub_knowledge/**`.
Judged against the shared design system (`statusTokens`, `Badge`/`CategoryChip`, `RelativeTime`, `Numeric`, `EmptyState`, `ROW_SEPARATOR`).

## 1. Knowledge type/scope badges hand-rolled from a private COLOR_MAP instead of statusTokens/Badge
- **Severity**: high
- **Category**: token
- **File**: src/features/overview/sub_knowledge/libs/knowledgeHelpers.ts:38-46 (consumed in KnowledgeRow.tsx:219-227)
- **Problem**: `COLOR_MAP` re-declares the entire status palette as raw Tailwind literals (`text-emerald-400 bg-emerald-500/10 border-emerald-500/20`, `text-red-400 bg-red-500/10 …`, etc.) — exactly the success/error/info/warning colors `statusTokens.ts` is the single source of truth for. The type pill and scope pill in `KnowledgeRow` then hand-assemble `${colors.bg} ${colors.text} border ${colors.border}` rounded-full spans. This duplicates the token table, drifts on theme changes (these are not themed `primary`/semantic props), and is the #1 system-deviation pattern. The memory side already does this correctly via `CategoryChip`.
- **Fix sketch**: Map `failure_pattern→error`, `tool_sequence→success`, `cost_quality→info`, `data_flow→warning` to `statusTokens` and render the pill with the catalog `Badge` component; delete `COLOR_MAP`. Keep the per-type *icon* in `KNOWLEDGE_TYPES`, drop the per-type color string.

## 2. Two different memory empty-state implementations for the same surface
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_memories/components/MemoryEmptyState.tsx:9-25 vs MemoriesPage.tsx:397-407
- **Problem**: A dedicated `MemoryEmptyState` (Brain glyph in a violet tile, hasFilters branch) exists, but `MemoriesPageBaseline` ignores it and renders `MotionEmptyState` for the no-data case and a bare `<p>No memories match current filters</p>` (line 458-461) for the filtered case. So the feature ships three visually distinct "empty" treatments. Neither path uses the catalog `EmptyState`. Inconsistent empty states read as unfinished.
- **Fix sketch**: Pick one. Adopt the shared `display/EmptyState` (or the agreed `MotionEmptyState`) for both the no-data and the no-match cases in `MemoriesPage`, and delete the now-dead `MemoryEmptyState.tsx`. The filtered case should be a proper empty state, not a centered paragraph.

## 3. Timestamps formatted with formatRelativeTime + regex instead of RelativeTime component
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_memories/components/MemoryCard.tsx:178,194 and MemoryDetailModal.tsx:48
- **Problem**: The created-at cell does `formatRelativeTime(memory.created_at).replace(/ ago$/, '')` — a string hack to strip "ago" — and renders a plain `<span>`. `display/RelativeTime` is the catalog component for this: it gives a `<time>` element, an absolute-time `title` tooltip on hover, and live re-rendering. The hand-rolled version has no tooltip, no semantic element, and a brittle locale-specific regex (breaks under i18n where the suffix isn't " ago").
- **Fix sketch**: Use `<RelativeTime value={memory.created_at} />` (with its compact/no-suffix prop if one exists) in the row and modal; remove the regex. Gains absolute-time-on-hover for free.

## 4. KnowledgeRow run/cost/duration counts use raw string interpolation instead of Numeric
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/overview/sub_knowledge/components/KnowledgeRow.tsx:234,304,308 (and NestedObjectCard `toLocaleString` at line 27)
- **Problem**: `{total} run{total !== 1 ? 's' : ''}`, the success/failure expanded tiles (`{entry.success_count}` / `{entry.failure_count}`), and `formatPrimitiveValue`'s `value.toLocaleString()` all bypass `Numeric`. The same dashboard's header already uses `<Numeric>` and `AnimatedCounter` (KnowledgeGraphDashboard.tsx:186,204), so within one feature counts are formatted two different ways — tabular alignment and locale grouping are inconsistent.
- **Fix sketch**: Wrap the counts in `display/Numeric`; the success/failure tiles especially should be `Numeric` for `tabular-nums` alignment. Aligns the row with its own dashboard header.

## 5. Memory row separator / zebra not using ROW_SEPARATOR or list tokens
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_memories/components/MemoryCard.tsx:171
- **Problem**: The row uses `border-b border-primary/10` plus an ad-hoc zebra `bg-white/[0.015]` and hover `bg-white/[0.05]`. The system's row-separator token is `ROW_SEPARATOR = border-primary/[0.06]` (listTokens.ts). `border-primary/10` is a slightly-too-strong duplicate, and raw `bg-white/[0.0xx]` is a non-themed hard-coded color that won't invert in a light theme — breaking dark/light parity that themed `secondary`/`primary` overlays preserve.
- **Fix sketch**: Use `ROW_SEPARATOR_B` for the bottom border and a themed `bg-primary/[0.02]`/`hover:bg-secondary/30` for zebra+hover instead of `bg-white/…`. The knowledge side already hovers with `bg-background/60`.

## 6. CapabilityScopeBadge and archived badge hand-built rather than using Badge/CategoryChip
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/overview/sub_memories/components/MemoryCard.tsx:15-26,126-134 (mirrored in MemoryDetailModal.tsx:86-92)
- **Problem**: Next to a correct `CategoryChip`, the same row hand-rolls a violet "capability scope" pill and a "archived" pill as bespoke `<span>`s with literal `bg-violet-500/15 border-violet-500/30 text-violet-300`. Mixing a catalog chip and two hand-rolled chips in one cell creates subtly different padding/radius/weight between adjacent badges, and the violet literal is duplicated verbatim in the detail modal. Reads as not-quite-aligned.
- **Fix sketch**: Render both via the catalog `Badge`/chip component with an `info`/`neutral` variant (or extend `CategoryChip`'s primitive). Define the violet scope color once (a token) rather than copy-pasting the three literals across card + modal.

## 7. Sparkline and stats-ring success/failure colors are raw hex, divorced from statusTokens
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_knowledge/components/KnowledgeRow.tsx:155 (`#34d399`/`#f87171`) and MemoriesPage.tsx:155 sparkline-equivalent (stats ring at MemoriesPage.tsx:351-357)
- **Problem**: The execution sparkline encodes success/failure as literal hex `#34d399` (green) / `#f87171` (red). These are semantic success/error signals that should derive from `statusTokens` (or at least the shared `IMPORTANCE_HEX`-style token file the memory side introduced). Hard-coded hex won't follow a theme and can disagree with the green/red used elsewhere (e.g. the expanded `text-emerald-400`/`text-red-400` tiles two lines of code away).
- **Fix sketch**: Pull success/error hex from a `statusTokens` hex export (add one if missing, as `memoryVisualTokens` did for importance) so the sparkline dots, the verified `ShieldCheck` (`text-emerald-400`, line 229), and the expanded count tiles share one green/red.

## 8. Two prototype/baseline memory layouts shipped behind a "Prototype" tab strip
- **Severity**: low
- **Category**: hierarchy
- **File**: src/features/overview/sub_memories/components/MemoriesPage.tsx:33-89
- **Problem**: The Memories page leads with a "Prototype" tab strip exposing Baseline/Dense/Graph variants, self-described in comments as a "throwaway scaffold." Shipping three competing layouts of the same data to end users dilutes the visual hierarchy (two header rows stacked: prototype strip + ContentHeader) and signals an unfinished surface — the knowledge side has no such scaffold, so the two sub-areas feel inconsistent in polish.
- **Fix sketch**: Gate the prototype strip behind `import.meta.env.DEV` (as the "seed mock" button already is on the knowledge side), or promote the chosen variant and delete the others, removing the stacked-header hierarchy.

## 9. AnnotateModal and MemoryDetailModal use raw buttons/inputs instead of catalog Button + FormField
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_knowledge/components/AnnotateModal.tsx:76-108 and MemoryDetailModal.tsx:51-56,124-136
- **Problem**: `KnowledgeGraphDashboard` correctly uses the catalog `Button` everywhere, but its own `AnnotateModal` hand-rolls the Cancel/Save `<button>`s (raw `px-4 py-1.5 … disabled:opacity-50`, no `focus-ring`) and raw `<input>`/`<textarea>` with duplicated `bg-secondary/40 border-primary/10` styling. `MemoryDetailModal` likewise hand-rolls its close/delete/footer buttons. Inconsistent button rendering within the same feature (catalog in the dashboard header, raw in its modal) is the clearest user-noticeable inconsistency — different focus rings, disabled treatment, and hover.
- **Fix sketch**: Replace the modal `<button>`s with catalog `Button` (`variant="danger"` for delete, `variant="ghost"`/`secondary` for cancel) and the text fields with the shared form-field/`Textarea` primitives so focus/disabled/hover come from the system, matching the dashboard.
