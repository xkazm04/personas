# UI Perfectionist — agent-memories-knowledge
> Total: 6
> Severity: 1 critical, 3 high, 1 medium, 1 low

## 1. Memories list has no loading state — empty state flashes during initial fetch
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/overview/sub_memories/components/MemoriesPage.tsx:375-385
- **Scenario**: On first open of the Memories tab (and on every persona/category/tier filter change), `fetchMemories` runs but `memories` is still `[]`. With no `hasFilters` set, the page immediately renders the full "No memories yet — when agents run they can store valuable notes" empty state, then snaps to the real list ~300ms later. A user with hundreds of memories sees a misleading "you have nothing" screen on every load.
- **Root cause**: `MemoriesPageBaseline` never reads any loading flag, and the slice doesn't expose one — `memorySlice.ts` has `memories`/`memoriesTotal`/`memoryStats` but no `memoriesLoading` (confirmed memorySlice.ts:11-40, 89-113). The sibling KnowledgeGraphDashboard.tsx:279-280 already does this correctly with `<ListSkeleton rows={6} rowHeight={ENTRY_ROW_ESTIMATE} />`, so the two surfaces behave inconsistently.
- **Impact**: confusion + inconsistency (empty-vs-loading ambiguity; the two intelligence tabs treat loading differently)
- **Fix sketch**: Add `memoriesLoading` to the slice (set true at the top of `fetchMemories`, false in `finally`). In the page, render `<ListSkeleton rows={6} rowHeight={48} />` (same component Knowledge uses) when `memoriesLoading && memories.length === 0`, gating the empty-state branch behind `!memoriesLoading`. Reuses the existing skeleton — zero new visual vocabulary.

## 2. Memories list has no error state — fetch failures are invisible in-surface
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/overview/sub_memories/components/MemoriesPage.tsx:375-461
- **Scenario**: If `fetchMemories` rejects (Tauri command fails, DB locked), `memorySlice.fetchMemories` only calls `reportError(...)` (memorySlice.ts:111) which fires a transient toast. The list area itself silently shows the "No memories yet" empty state — identical to a genuinely empty DB — with no Retry. The user can't tell "load failed" from "nothing here".
- **Root cause**: No `memoriesError` field in the slice and no error branch in the page. KnowledgeGraphDashboard.tsx:260-278 has a complete inline error card (AlertTriangle + message + Retry button) — the memories side simply omits this entire state, making the two tabs asymmetric.
- **Impact**: error-blind + inconsistency (transient toast is easily missed; no recovery affordance)
- **Fix sketch**: Add `memoriesError: string | null` to the slice; set it in the catch and clear on success. Render the same red error card pattern as KnowledgeGraphDashboard.tsx:260-278 (AlertTriangle, `fetchError` text, danger Retry button calling `fetchMemories`) above the list, gated before the empty-state branch.

## 3. Conflict resolution has no clear primary — "Keep A" and "Keep B" are visually identical
- **Severity**: high
- **Category**: visual-hierarchy
- **File**: src/features/overview/sub_memories/components/ConflictCard.tsx:88-98
- **Scenario**: When resolving a conflict, the user faces (for duplicates) Merge / "Keep <A title>…" / "Keep <B title>…" / Dismiss. Both Keep buttons use the exact same `variant="accent" accentColor="emerald"` with a Check icon, so the two destructive-by-omission choices (each silently deletes the *other* memory) look interchangeable. Nothing signals which is recommended, and "keep A" giving no hint that B is deleted invites accidental data loss.
- **Root cause**: Identical styling on two mutually-exclusive emerald buttons + truncated `…title….slice(0,20)` labels that often collide for near-duplicate titles. There's no emphasis distinction (recommended vs alternative) and no "deletes the other" cue. Merge (the safest action for duplicates) is first but visually equal-weight via the same xs size.
- **Impact**: confusion + unpolished (two same-looking buttons that do opposite, irreversible things)
- **Fix sketch**: For duplicates, make Merge the single emphasized primary (filled accent, slightly larger) and demote both Keep buttons to outline/secondary tone; pair each Keep with a subtle "removes the other" sublabel or a Trash micro-icon on the losing side. Keep Dismiss neutral. Add an `aria-label` spelling out the full effect ("Keep '<A>', delete '<B>'") since the visible label is truncated.

## 4. Duplicated/orphaned memory components — empty-state, table-header, header-actions, filter-bar all re-inlined in the page
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/overview/sub_memories/components/MemoriesPage.tsx:230-461
- **Scenario**: `MemoriesPageBaseline` is ~250 lines that inline the header action cluster (tabs + Review + Add + Delete-all, lines 237-286), the search/stats/filter row (320-373), the column-header grid (389-434), and two empty states (375-385, 436-439) — while standalone `MemoryEmptyState.tsx`, `MemoryTableHeader.tsx`, `MemoryHeaderActions.tsx`, and `MemoryFilterBar.tsx` exist for exactly these jobs. A grep shows the extracted versions are imported only by `index.ts`/`DashboardHomeMissionControl`, not by the page they were built for. So the canonical empty-state markup lives in two divergent copies (see finding 5), and any visual fix must be applied in multiple places.
- **Root cause**: Components were extracted but never adopted by the baseline page (the page kept its inline copies), leaving parallel sources of truth and a monolithic 480-line file. Dense and Graph variants inline their own header/empty markup too, tripling drift.
- **Impact**: inconsistency + unpolished (guaranteed drift; one card/header tweak needs N edits)
- **Fix sketch**: Adopt the existing `MemoryTableHeader`, `MemoryFilterBar`, and a shared empty-state component across baseline/dense/graph so the column template, filter chrome, and "no memories / no match" copy come from one place; delete or reconcile the now-redundant inline blocks. If `MemoryEmptyState` is superseded by `MotionEmptyState`, remove it to kill the dead second copy (finding 5).

## 5. Two different "empty" treatments — MotionEmptyState in the page vs the orphaned MemoryEmptyState component
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/overview/sub_memories/components/MemoryEmptyState.tsx:9-25
- **Scenario**: The page's true-empty state uses the rich `MotionEmptyState` (animated motif, MemoriesPage.tsx:376-385) and its filter-empty state is a bare centered `<p>No memories match current filters</p>` (MemoriesPage.tsx:436-439). Meanwhile `MemoryEmptyState.tsx` renders a *third*, different look entirely — a 64×64 violet rounded tile with a Brain glyph and its own copy. Depending on which surface a user hits, "nothing here" looks like three unrelated designs.
- **Root cause**: `MemoryEmptyState` is dead relative to the baseline page (only `index.ts` re-exports it) yet still ships its own divergent styling; the page's filter-empty branch is a plain paragraph with none of the empty-state polish.
- **Impact**: inconsistency (three visual languages for one conceptual state)
- **Fix sketch**: Pick one empty-state component for the feature (the `MotionEmptyState` motif is the richest) and route both the no-data and no-filter-match cases through it (filter case shows a "Clear filters" action). Delete `MemoryEmptyState.tsx` or make it the single shared implementation that the page actually renders.

## 6. Annotation accept/reject are equal-weight icon-only buttons differentiated by color alone
- **Severity**: low
- **Category**: accessibility
- **File**: src/features/overview/sub_knowledge/components/KnowledgeRow.tsx:242-261
- **Scenario**: A pending (unverified) annotation shows two same-size 28px icon buttons — a green CheckCircle (verify) and a red X (dismiss). They have `aria-label`/`title` (good), but for a colorblind user the only at-a-glance difference between "accept" and "reject" is hue, and both carry equal visual weight despite verify being the constructive/primary action. There's also no inline "pending review" text cue — the pending state is conveyed only by the buttons' presence.
- **Root cause**: Color-only differentiation (emerald vs red tint) with identical geometry, and no textual/iconographic emphasis ranking verify over dismiss; "pending" is implicit.
- **Impact**: inaccessible + unpolished (color-not-only violation; flat hierarchy on a accept/reject pair)
- **Fix sketch**: Give the unverified row a small text/badge "Pending review" cue (not color-only), and differentiate the pair beyond hue — e.g. verify as a filled emerald button, dismiss as a quieter ghost X — so shape/weight (not just color) distinguishes the constructive action. Icons already differ (Check vs X), so ensure that distinction is preserved at the chosen sizes.
