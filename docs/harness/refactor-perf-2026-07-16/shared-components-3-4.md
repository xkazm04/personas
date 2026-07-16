# shared/components [3/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Shared UI & Design System | Files read: 34 | Missing: 0

## 1. Two unrelated `TerminalBody` components with the same export name and overlapping purpose
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/components/progress/TerminalBody.tsx:49
- **Scenario**: `progress/TerminalBody.tsx` (simple dot-per-line renderer + its own `classifyLine` keyword classifier + `useTerminalScroll`) coexists with `terminal/TerminalBody.tsx` (virtualized, uses the shared `useTerminalClassification` + `TERMINAL_STYLE_MAP` vocabulary). `CliOutputPanel` imports the terminal one; `AnalysisModeView`/`TransformModeView` import the progress one. Any dev grepping "TerminalBody" or restyling terminal output must discover and update two independent implementations.
- **Root cause**: The progress views grew their own lightweight terminal renderer instead of reusing the shared terminal component; the ad-hoc `classifyLine`/`LINE_STYLES` in the progress copy re-invents the classification vocabulary that already lives in `lib/utils/terminalColors` + `useTerminalClassification`.
- **Impact**: Style/behavior drift between the two terminal surfaces (they already color/classify lines differently), duplicated auto-scroll logic (`useTerminalScroll` vs the inline sticky-scroll in the terminal version), and a confusing identical-name collision.
- **Fix sketch**: Point `AnalysisModeView`/`TransformModeView` at `terminal/TerminalBody` (it already supports `maxHeightClass` and running-cursor), passing a compact style if the line-number/dot look must stay; or at minimum rename the progress one (e.g. `ProgressTerminalLines`) and have its `classifyLine` delegate to `useTerminalClassification`'s vocabulary. Delete `useTerminalScroll` once the virtualized body (which has its own sticky scroll) is used.

## 2. `AbsoluteTime` constructs a new `Intl.DateTimeFormat` on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/display/AbsoluteTime.tsx:51
- **Scenario**: `AbsoluteTime` is the documented canonical timestamp primitive, used in 35 files — including dense list/table rows (execution rows, event logs, recipe history). Every mount and every prop-change render calls `new Intl.DateTimeFormat(undefined, FORMATS[variant])`, one of the most expensive constructors in the platform (locale-data resolution, typically 50–200µs each).
- **Root cause**: The format options are cached (`FORMATS`) but the formatter instance is not; `memo` only prevents re-renders with identical props, not the per-mount / per-changed-timestamp construction cost in long lists.
- **Impact**: A table page rendering ~100 rows with 1–2 timestamps each pays 10–40ms of pure formatter construction per data refresh, on a component whose whole point is to be used everywhere.
- **Fix sketch**: Cache one formatter per variant at module level: `const FORMATTERS: Record<AbsoluteTimeVariant, Intl.DateTimeFormat> = { datetime: new Intl.DateTimeFormat(undefined, …), … }` (or lazily via a small `getFormatter(variant)` memo map, which also stays correct if locale can change at runtime). Then `FORMATTERS[variant].format(ms)`. Optionally also skip the `new Date(ms).toISOString()` round-trip for the tooltip by letting `formatRelativeTime` accept epoch ms.

## 3. `progress/TerminalBody` re-classifies and re-renders every line on each streamed append, unvirtualized
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/components/progress/TerminalBody.tsx:57
- **Scenario**: `AnalysisModeView`/`TransformModeView` show live CLI output; each new streamed line re-renders the whole component, running `classifyLine` (multi-substring scan) over all N lines and re-committing N DOM rows — O(n) per append, O(n²) over a run. Long analysis/transform runs can emit hundreds to thousands of lines into a 200px-tall scroll box.
- **Root cause**: No virtualization and no memoization: classification results are recomputed inline in the `.map()` instead of being derived once per line (the sibling `terminal/TerminalBody` already solved both with `@tanstack/react-virtual` + `useTerminalClassification`, which caches classification per line).
- **Impact**: Progressive jank while a run streams — exactly when the UI also animates phase banners; on Tauri/WebView2 large DOM commits are a known hitch source (see `DeferUntilIdle`'s own docs).
- **Fix sketch**: Reuse the virtualized `terminal/TerminalBody` (finding #1), which makes this moot. If the simple renderer stays, wrap it with the existing `useTerminalClassification`-style memo (classify only lines beyond the previously classified count) and consider rendering only the last ~500 lines outside a "show all" toggle.

## 4. `useSectionScrollSpy` does per-section `getBoundingClientRect` on every scroll event with no rAF coalescing
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: layout-thrash
- **File**: src/features/shared/components/layout/settings/useSectionScrollSpy.ts:54
- **Scenario**: While scrolling a settings page, `compute()` runs on every native scroll event (often > 60/s on WebView2 wheel/trackpad), reading `getBoundingClientRect` for the container plus every registered section, then calling `setActiveId` each time.
- **Root cause**: The scroll handler is bound raw — no `requestAnimationFrame` coalescing — and `setActiveId(current)` is invoked unconditionally even when the active id did not change (React bails out on identical state, but the layout reads still happen at event rate).
- **Impact**: Bounded (section counts are small), but it's synchronous layout work on the hottest interaction path of settings pages, stacked on top of whatever the page itself does on scroll.
- **Fix sketch**: Wrap `compute` in an rAF gate (`if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; …reads… })`). That caps the work at once per frame regardless of event rate; the rest of the hook can stay as-is.

## 5. `FullScreenOverlay` Escape listener contradicts its own "capture phase" comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/shared/components/layout/FullScreenOverlay.tsx:36
- **Scenario**: The comment block says "Capture phase so it wins over content that also listens for Escape, but only when nothing more local handled it" — but `window.addEventListener('keydown', onKey)` registers a plain bubble-phase listener, and the handler never checks `e.defaultPrevented`.
- **Root cause**: The intent described in the comment (capture + defer-to-local-handlers) was never implemented, or the implementation changed and the comment was left behind.
- **Impact**: Misleading documentation on shared shell code: the next maintainer will assume capture semantics exist. Behaviorally, an inner modal that stops propagation on Escape will silently also keep this overlay open (or not — depending on where the inner handler is bound), which is the ambiguity the comment claims to have resolved.
- **Fix sketch**: Decide the real contract: either add `{ capture: false }` semantics honestly by checking `if (e.defaultPrevented) return;` before `onClose()` and rewrite the comment, or implement the described behavior (`addEventListener('keydown', onKey, true)` plus the local-handled guard). Keep listener add/remove options symmetric.

## 6. `HeroMesh` preset typing is `Record<string, …>`, so `HeroMeshPreset` degrades to `string` and a typo renders a blank mesh
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/shared/components/display/HeroMesh.tsx:18
- **Scenario**: `PRESETS` is declared `Record<string, PresetConfig>`, so `export type HeroMeshPreset = keyof typeof PRESETS` is just `string`. A caller passing `preset="dashbaord"` type-checks fine, then `PRESETS[preset]!` non-null-asserts `undefined` and `config.orbs.map` throws at runtime (or would render nothing if guarded).
- **Root cause**: The explicit `Record<string, PresetConfig>` annotation widens the key type, defeating the exported union the `HeroMeshPreset` type was clearly meant to be.
- **Impact**: Loses compile-time safety on a shared visual primitive; the `!` assertion converts a typo into a render-time crash of the hero section.
- **Fix sketch**: Drop the annotation and use `const PRESETS = { welcome: {…}, dashboard: {…}, detail: {…} } satisfies Record<string, PresetConfig>;` — `keyof typeof PRESETS` then becomes the literal union `'welcome' | 'dashboard' | 'detail'` and the `!` can be removed.
