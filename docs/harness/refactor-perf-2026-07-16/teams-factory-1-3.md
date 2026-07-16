# teams/factory [1/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Batch eligibility re-derives every project's passport twice per action per render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_factory/passport/improve/DeployPopover.tsx:175
- **Scenario**: With the Deploy popover open, the JSX calls `eligibleForBatch(a)` twice per task action (once for the `> 1` guard on line 175, once for the count on line 177). Each call maps `engine.allRaw()` through `derivePassportFromMetadata` — a nontrivial derivation (9 regex tests over a joined keyword haystack, score math, object assembly) — for every project in the fleet, on every render of the popover (renders fire on `expanded`/`busy`/`pos` state changes).
- **Root cause**: `eligibleForBatch` is a plain closure invoked inline in JSX instead of a memoized value; the already-derived passports from `usePassportData` aren't reused, so the popover re-derives from raw each time.
- **Impact**: With ~10 projects and 3 visible actions that's ~60 full passport derivations per render, several renders per interaction. Bounded (popover-open only) but pure waste, and it grows linearly with fleet size × actions.
- **Fix sketch**: Compute once per render via `useMemo(() => new Map(actions.map(a => [a.id, eligibleForBatch(a)])), [actions, engine])` and read the map in JSX; better still, have the improve engine expose the passports already derived in `usePassportData` (`allPassports()`) so no popover re-derives from raw.

## 2. Tauri event listener leaks when StandardsScan popover unmounts before `listen` resolves
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/teams/sub_factory/passport/improve/StandardsScan.tsx:60
- **Scenario**: The user clicks the shield icon and immediately closes the popover (Escape / outside click). The `listen('dev_tools_standards_scan_status', …)` promise resolves after the effect's cleanup has already run; `unlisten` is still `undefined` at cleanup time, so the resolved unlisten fn is stored into a dead variable and the Tauri listener is never removed.
- **Root cause**: The cleanup reads `unlisten?.()` but there is no "unmounted" flag to unregister a listener that arrives late — the classic async-subscribe race.
- **Impact**: Every quick open/close of the popover accumulates a global event listener that refetches standards for a stale slug on every scan-status event, for the lifetime of the app session (desktop app, long-lived).
- **Fix sketch**: Track liveness: `let alive = true; listen(...).then(f => { if (alive) unlisten = f; else f(); }); return () => { alive = false; unlisten?.(); };`. Same pattern should be audited in sibling popovers using `listen`.

## 3. `passportToMarkdown` is generated eagerly for every cover on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx:360
- **Scenario**: `CoverBody` renders `<CopyButton text={passportToMarkdown(p, Date.now())} …/>`. The full markdown readiness report is built for each project cover on every wall render — sort change, view toggle, any parent state change — even though the string is only needed when the user clicks copy. `Date.now()` in render also makes the prop unstable, defeating any memo on CopyButton.
- **Root cause**: The export string is computed as an eager prop instead of lazily at click time.
- **Impact**: N (projects) markdown serializations per render on the wall — the module's most-visited surface. Bounded per call but repeated constantly, and the always-changing `text` prop forces CopyButton to re-render every time.
- **Fix sketch**: Let CopyButton accept `text: string | (() => string)` and pass `() => passportToMarkdown(p, Date.now())`; or wrap in `useMemo(() => passportToMarkdown(p, exportedAt), [p])` with a stable timestamp captured on click.

## 4. Anchored-popover positioning + dismiss logic triplicated
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_factory/passport/improve/DeployPopover.tsx:47
- **Scenario**: DeployPopover (lines 47–62), ImprovePopover (lines 53–68), and StandardsScan's FindingsPopover (lines 72–87) each carry a near-identical ~25-line pair of effects: the flip-above/below `useLayoutEffect` positioning (same `spaceBelow`/`Math.max(8, …)` math, differing only in WIDTH and the re-measure deps) and the Escape-key + outside-mousedown dismiss effect (identical including the `setTimeout(…, 0)` mount guard).
- **Root cause**: Each popover was written by copying the previous one instead of extracting the shared anchoring behavior.
- **Impact**: Three copies of subtle window-geometry and event-timing code; a fix in one (e.g. the resize/scroll re-position gap all three share) must be repeated in the other two, and they will drift.
- **Fix sketch**: Extract a `useAnchoredPopover({ anchor, width, deps })` hook returning `{ panelRef, pos }` plus a `useDismiss(panelRef, onClose)` (or fold both into one hook). Each popover keeps only its WIDTH constant and content. ~50 lines net deletion.

## 5. Two independent Sparkline implementations in the same feature
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_factory/factoryPrimitives.tsx:9
- **Scenario**: `factoryPrimitives.tsx` exports `Sparkline` (min/max-normalized polyline, `series`/`color`/`width`/`height`) and `passport/passportWidgets.tsx:142` exports another `Sparkline` (`values`/`width`/`height`/`color`) with the same normalization math and SVG output, differing only in prop names, default sizes, and edge padding constants.
- **Root cause**: The passport surface grew its own copy instead of importing the factory primitive one directory up.
- **Impact**: Rendering drift risk (the two already disagree on the sub-2-points fallback: em-dash span vs `null`) and doubled maintenance for any styling/a11y fix.
- **Fix sketch**: Keep one Sparkline (factoryPrimitives is the natural home per its file comment), give it optional `fallback` and padding props, and re-export or import it in passportWidgets. Verify no other cross-context callers of the passport variant before deleting.

## 6. Duplicate measure_config "describe" helpers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_factory/KpiConsole.tsx:30
- **Scenario**: `KpiConsole.describeMethodic` and `KpiProposalsPanel.describeProcedure` (KpiProposalsPanel.tsx:25) both JSON-parse a `measure_config` string and produce a human one-liner keyed on `cmd`/`metric`/`connector`/`instruction`, with slightly different fallbacks and key coverage (`recipe` only in one, `parse` only in the other).
- **Root cause**: The same presentation logic was re-written where each surface needed it.
- **Impact**: The two surfaces already describe the same config differently (a `recipe` config reads as "manual measurement" in the console); any new measure kind must be added twice.
- **Fix sketch**: Merge into one `describeMeasureConfig(cfg: string | undefined): string` in factoryModel.ts (it already owns the measure-kind vocabulary), covering the union of keys, and import it in both components.
