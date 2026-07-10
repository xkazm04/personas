> Context: shared/chrome
> Total: 8
> Critical: 0  High: 1  Medium: 4  Low: 3

## 1. Command-mode keyboard selection executes the wrong row
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src/features/shared/chrome/CommandPalette.tsx:213-378 (esp. 218-223, 352-378) + CommandPaletteResults.tsx:78-87
- **Scenario**: Type a command-mode query (leading `>`, e.g. `>a`) that matches BOTH plain command items (`kind: 'action'`, like "Go to Agents") and per-agent command items (`kind: 'agent-action'`, like "Run …"). `items` is built by `commandItems.filter(...).sort(byScore)` — a single list interleaved purely by fuzzy score. But `sections` re-groups by kind: `addSection('action')` then `addSection('agent-action')`, assigning `globalIndex` in that grouped order. Keyboard nav indexes the flat, score-sorted array (`items[selectedIndex]`, line 343), while the highlighted row is the one whose `globalIndex === selectedIndex`. When an agent-action outscores an action, the two orderings diverge: the visually-highlighted row is not the row Enter runs.
- **Root cause**: Two independent orderings for the same list — a score-sorted flat array for keyboard/execute vs. a kind-grouped array for `globalIndex`/render. They only coincide when grouping preserves array order (true in normal mode, false in command mode because of the score sort mixing kinds).
- **Impact**: User presses Enter (or arrows to a row) and a *different* command fires than the one highlighted — e.g. silently triggering "Run <agent>" (an ad-hoc execution) instead of a navigation. Wrong-action-executed correctness bug.
- **Fix sketch**: Drive keyboard selection off the same grouped/`globalIndex` sequence the UI renders (e.g. flatten `sections` in render order into the nav array), or in command mode keep `items` in the grouped order the sections use (sort within each kind, concatenate action-then-agent-action) instead of one global score sort.

## 2. SchedulesSidebarNav never unsubscribes from overviewStore (subscription leak)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/shared/chrome/sidebar/SidebarLevel2.tsx:285-293
- **Scenario**: `useEffect(() => { void import(...).then(({useOverviewStore}) => { ...; return useOverviewStore.subscribe(...); }).then((unsub) => { return () => unsub?.(); }); }, [])`. The effect body returns `undefined`, so React has no cleanup. The `() => unsub?.()` is returned from an inner `.then` callback — it becomes a resolved promise value that nothing ever calls. Every time the user navigates to the `schedules` sidebar section (a real, settable `sidebarSection` — see PersonasPage.tsx:304, uiSlice.test.ts) and away, one permanent `overviewStore` subscriber accumulates.
- **Root cause**: Cleanup returned from within an async `.then()` chain instead of from the effect itself. Contrast the vault effect directly above (lines 56-70) which correctly assigns to `vaultUnsub` and returns cleanup synchronously.
- **Impact**: Growing set of live store subscribers across navigations → wasted `setCronAgents` work and a memory leak (each closure retains component state). Slow-burn, not a crash.
- **Fix sketch**: Mirror the vault pattern: `let unsub; void import(...).then(({useOverviewStore}) => { ...; unsub = useOverviewStore.subscribe(...); }); return () => unsub?.();`.

## 3. TitleBar onResized listener can leak if unmounted before the promise resolves
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/features/shared/chrome/TitleBar.tsx:24-34
- **Scenario**: `appWindow.onResized(...).then((fn) => { unlisten = fn; })` registers asynchronously. If the component unmounts before that promise resolves, the effect cleanup runs `unlisten?.()` while `unlisten` is still `undefined`; the listener is then assigned afterward and never detached.
- **Root cause**: No cancellation flag guarding the async listener registration; cleanup captures `unlisten` by closure before it is set.
- **Impact**: Orphaned Tauri resize listener firing `setMaximized` on an unmounted component. TitleBar is effectively a singleton mounted for the app lifetime, so real-world exposure is tiny — hence low.
- **Fix sketch**: Add a `let cancelled = false` guard; in the `.then`, if `cancelled` call `fn()` immediately, else store it; cleanup sets `cancelled = true` and calls `unlisten?.()`.

## 4. AuthButton.tsx is dead code (superseded by DesktopFooter's AccountFooterIcon)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/shared/chrome/AuthButton.tsx:1-119
- **Scenario**: Grepped `AuthButton` across `src/` — the only hit is its own definition file; nothing imports or renders it. Its entire behaviour (Google sign-in button, avatar, offline dot, sign-out dropdown, outside-click close) is reimplemented by `AccountFooterIcon` inside DesktopFooter.tsx (lines 29-107), which is the version actually mounted in the footer.
- **Root cause**: Auth entry point moved into the footer; the standalone component was left behind.
- **Impact**: Maintainability — a whole auth-UI component drifts unused (two divergent sign-in surfaces to keep in sync). Deleting it removes a `@/features/shared/components/buttons` dependency edge from chrome.
- **Fix sketch**: Delete `AuthButton.tsx`. If a shared auth button is genuinely wanted, extract the footer's `AccountFooterIcon` instead and consume it in both places.

## 5. ActivityDots.tsx is dead code (OrbitDots is the live component)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/shared/chrome/sidebar/ActivityDots.tsx:1-end
- **Scenario**: Grepped `ActivityDots` across `src/` — only self-references (interface + export). SidebarLevel1.tsx imports and renders `OrbitDots` (line 6, 273) for the per-persona activity dots, not `ActivityDots`. No dynamic/registry usage.
- **Root cause**: Superseded by the newer `OrbitDots` implementation; the older dots component was never removed.
- **Impact**: Maintainability / dead weight in the sidebar folder.
- **Fix sketch**: Confirm no story/test references, then delete `ActivityDots.tsx`.

## 6. StandardToastItem and HealingToastItem duplicate the RAF countdown/elapsed loop
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/chrome/ToastContainer.tsx:47-94 vs 167-208
- **Scenario**: The two toast item components carry a near-identical ~30-line block: `paused/pausedRef/elapsedRef/lastTickRef` refs, `isPaused = paused || !isDocumentVisible`, and the RAF `tick` that accrues elapsed time, calls `onDismiss` at `toast.duration`, and updates the second-granularity elapsed label. Only the surrounding markup differs.
- **Root cause**: Copy-paste when the healing variant was added; the timer/pause logic was never lifted out.
- **Impact**: Maintainability — any fix to pause-on-hover / visibility-pause / dismiss timing must be made twice and can silently diverge. (They already differ only cosmetically, so consolidation is safe.)
- **Fix sketch**: Extract a `useAutoDismiss({ id, duration, timestamp, onDismiss })` hook returning `{ isPaused, elapsedLabel, onMouseEnter, onMouseLeave }`; both items consume it.

## 7. disabledSections is permanently empty, leaving dead "coming soon" UI paths in SidebarLevel1
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/shared/chrome/sidebar/Sidebar.tsx:105-107 → SidebarLevel1.tsx:212, 232-237, 264-268
- **Scenario**: `disabledSections` is `useMemo(() => new Set<SidebarSection>(), [])` — always empty — and threaded into SidebarLevel1 as a prop. Consequently `isDisabled` is always `false`, so the `cursor-not-allowed opacity-40` branch, the `disabled` attr, the "(coming soon)" aria/title suffixes, and the entire `{isDisabled && (<span>…soon_badge</span>)}` block (lines 264-268) are unreachable.
- **Root cause**: Section-gating moved to tier/dev filtering (`filterByTier`, `devOnly`); the older per-section "disabled/coming soon" mechanism was left wired but never populated.
- **Impact**: Maintainability — dead conditional branches plus an unused prop chain (and unused `t.sidebar.coming_soon` / `soon_badge` strings).
- **Fix sketch**: Drop the `disabledSections` prop and collapse the `isDisabled` branches in SidebarLevel1, or, if "coming soon" is still desired, source it from a `SectionDef.comingSoon` flag in `sidebarData.ts`.

## 8. Dead `case 'schedules'` comment/aliases and stale label indirection around SidebarLevel2
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/shared/chrome/sidebar/sidebarData.ts:28-33 (deprecated `simpleHidden`/`devModeOnly`) + SidebarLevel1.tsx:214 (`section.devModeOnly`)
- **Scenario**: `SectionDef` keeps `@deprecated simpleHidden` and `devModeOnly` "backward-compatible aliases … computed from minTier by filterByTier()", but `filterByTier` (lines 51-59) only reads `minTier`; it never derives or sets these. SidebarLevel1 line 214 reads `section.devModeOnly` (always `undefined` on the `sections` array) to add a ring class — a permanently-false branch.
- **Root cause**: Tier migration replaced `simpleHidden`/`devModeOnly` with `minTier`/`devOnly` but the compat fields and their one consumer were left in place.
- **Impact**: Maintainability — misleading "computed from minTier" comment (nothing computes them) and a dead styling branch.
- **Fix sketch**: Remove `simpleHidden`/`devModeOnly` from `SectionDef` and the `isDevModeSection` read in SidebarLevel1 (keep `devOnly`), or actually populate them in `filterByTier` if any consumer still needs them.
