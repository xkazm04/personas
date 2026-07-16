# settings/appearance — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: App Shell, Settings & Sharing | Files read: 13 | Missing: 0

## 1. Selection-card grid pattern duplicated 4x across settings sections
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/settings/sub_appearance/components/AppearanceBrightnessSettings.tsx:39 (also AppearanceDensitySettings.tsx:26, AppearanceTextSizeSettings.tsx:16, AppearanceTimezoneSettings.tsx:43)
- **Scenario**: Any styling tweak to the option-card look (active border, Check badge placement, hover state, a11y attrs) must be repeated in 4 files; they have already drifted — Density has `aria-pressed`, the other three don't; Brightness hint uses `typo-body` while Density/Timezone use `typo-caption`.
- **Root cause**: Brightness, Density, TextSize, and Timezone each hand-roll the identical `<button>` card: same ~5-line className ternary (`border-primary/30 bg-primary/5` active / `border-primary/10 hover:...` idle), same absolute top-right `<Check className="w-3.5 h-3.5 text-primary" />`, same label + description spans.
- **Impact**: ~120 LOC of copy-paste; inconsistent accessibility (missing `aria-pressed` on 3 of 4) and guaranteed future drift in a user-facing settings surface.
- **Fix sketch**: Extract a shared `AppearanceOptionCard` (props: `active`, `onSelect`, `label`, `description`, optional `icon`/`topSlot`) next to `AppearanceToggleRow` — which already proves the pattern works here — and render it from all four grids. Add `aria-pressed={active}` once in the shared component.

## 2. Dead conditional in ColorRow — both ternary branches are identical
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/settings/sub_appearance/components/ColorRow.tsx:48
- **Scenario**: `` className={`typo-code font-mono ... ${isOverridden ? 'text-foreground' : 'text-foreground'}`} `` — the override/auto distinction the ternary was meant to convey renders identically in both states.
- **Root cause**: Leftover from an earlier version that presumably styled the non-overridden hex value as muted; one branch was edited without deleting the conditional.
- **Impact**: Misleading dead code — a reader assumes overridden values look different; the intended visual cue (dimmed "auto" value) is silently lost.
- **Fix sketch**: Either restore the intent (`isOverridden ? 'text-foreground' : 'text-muted-foreground'`) or delete the ternary and keep the single class. One-line change; verify against the design's treatment of the adjacent `auto` chip.

## 3. ThemePreview remounts a full animated subtree on every keystroke/slider tick
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_appearance/components/ThemePreview.tsx:54
- **Scenario**: Dragging the gradient-angle slider (or the ColorPicker hue slider) in CustomThemeCreator changes `derivedVars` on every pointer-move; `hash` changes each tick, so `motion.div key={hash}` unmounts and remounts the entire ~40-node preview subtree per tick, each spawning a 0.2s AnimatePresence exit animation that overlaps the next.
- **Root cause**: The crossfade is keyed on the concatenated value of all 14 preview CSS vars, so continuous inputs produce a new React key per frame instead of updating styles in place. The `useMemo` at line 43 is also self-defeating — its dep array is rebuilt by `.map()` every render.
- **Impact**: Dozens of mount/unmount cycles plus stacked exit animations per second while dragging — visible jank and GC churn on the exact interaction (live theme tuning) the preview exists for.
- **Fix sketch**: Drop the key-remount crossfade for continuous updates: render one `motion.div` and let inline `style` values update in place (CSS `transition: background-color 0.2s` gives the same softness for free). If a crossfade is truly wanted, debounce the hash (e.g. only re-key 150ms after vars settle) or key on `baseMode` only. Delete the spread-deps useMemo either way.

## 4. AppearanceThemeSwatch leave-timer never cleared on unmount
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/settings/sub_appearance/components/AppearanceThemeSwatch.tsx:27
- **Scenario**: Hover a swatch, then immediately switch to the Custom tab (or navigate away from Settings) — the component unmounts while `leaveTimer` is pending, and the timeout later calls `setShowHover` on an unmounted component.
- **Root cause**: `handleLeave` schedules a 180ms `setTimeout` stored in a ref, but there is no `useEffect` cleanup clearing it on unmount.
- **Impact**: Bounded (single 180ms timer per swatch), so no real accumulation — but it is a textbook listener/timer leak and a stray no-op state update; costs two lines to fix.
- **Fix sketch**: Add `useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, [])` in the swatch.

## 5. memo(AppearanceThemeSwatch) defeated by inline onSelect closures
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/settings/sub_appearance/components/AppearanceThemingSection.tsx:55
- **Scenario**: Any AppearanceThemingSection re-render (theme selection, custom-theme save, language change) re-renders every swatch in both grids because `onSelect={() => setTheme(th.id as ThemeId)}` produces a fresh function per swatch per render, breaking the `memo()` wrapper the swatch was deliberately given.
- **Root cause**: The child was memoized (it computes WCAG contrast ratios per render), but the parent passes an unstable callback prop, so `memo`'s shallow compare never hits.
- **Impact**: Low in practice — the theme list is small (~a dozen tiles) and contrast math is memoized inside the child — but the `memo` is currently pure overhead: it pays the prop-compare cost and delivers zero skipped renders.
- **Fix sketch**: Change the swatch prop to `onSelect: (id: ThemeId) => void`, pass the stable store setter (`onSelect={setTheme}`), and have the swatch call `onSelect(theme.id)`. Alternatively remove the `memo()` and accept re-renders; either state is better than memo-plus-unstable-props.
