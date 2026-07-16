# hooks/utility [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. useAppSetting reloads (and clobbers edits) on every render when callers pass inline validators
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: refetch-storm
- **File**: src/hooks/utility/data/useAppSetting.ts:52
- **Scenario**: `NotificationSettings.tsx:45` and `:89` pass inline arrow functions as `validate`. The load effect depends on `[defaultValue, key, validate]`, so a fresh `validate` identity every render re-runs the effect: `getAppSettingCoalesced` is invoked on each render of the settings panel, and when the promise resolves, `setValueRaw(val)` overwrites whatever the user has typed but not yet saved.
- **Root cause**: The effect treats `validate` (and `defaultValue`) as data dependencies when they are configuration that should be latched. Callers naturally pass inline closures, defeating the mount-once contract.
- **Impact**: Repeated Tauri IPC round-trips per render on the settings screens (coalescing softens but does not eliminate this — each render after the coalesce window fires a new probe), plus a real UX bug: in-progress edits silently revert to the stored value whenever an unrelated state change re-renders the component.
- **Fix sketch**: Read `validate` and `defaultValue` through refs (`validateRef.current = validate` on each render) and make the load effect depend only on `[key]`, mirroring the `valueRef` pattern already used for `save`. Alternatively guard with a `hasLoadedRef` per key so the load runs once per key change.

## 2. useFilteredCollection memoization never hits — every call site passes an inline spec object
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/hooks/utility/data/useFilteredCollection.ts:57
- **Scenario**: All three consumers (ManualReviewList.tsx:138, KnowledgeGraphDashboard.tsx:109, GlobalExecutionList.tsx:105/125) pass a fresh object literal as `spec`, so the `useMemo` dep `[items, spec]` invalidates on every render. The hook re-filters and returns a new `filtered` array identity each render.
- **Root cause**: The API takes a composite object as a memo dependency without requiring or providing stabilization, so the memo is structurally dead.
- **Impact**: The filter passes re-run on every parent render (bounded O(n·filters), so not the main cost), but the fresh array identity cascades: downstream `useMemo`s recompute and effects keyed on the result re-fire — e.g. ManualReviewList.tsx:147's effect depends on `filteredReviews` and re-runs every render. GlobalExecutionList chains two of these hooks, doubling the churn.
- **Fix sketch**: Keep the same call-site ergonomics but stabilize internally: split deps into the primitive values actually used — e.g. build a stable dep from `spec.exact` values/fields (`spec.exact?.map(m => `${String(m.field)}=${m.value}`).join('|')`) plus the `custom` predicate identities — or accept `exact`/`custom` as separate memoized params. Cheapest honest fix: document that `spec` must be memoized and wrap the three call sites' specs in `useMemo`.

## 3. useAnimatedNumber has no consumers — and its effect wiring can never animate anyway
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/hooks/utility/timing/useAnimatedNumber.ts:16
- **Scenario**: Grep across `src/` finds zero call sites — the only references are the definition and the barrel re-export in `src/hooks/index.ts:59`. (Cross-context verification: no dynamic usage pattern plausible for a hook; barrel export keeps it in the bundle.)
- **Root cause**: Consumers migrated to the DOM-writing `AnimatedCounter`/rafAnimationEngine path (as the hook's own doc comment hints), leaving this wrapper orphaned. It also carries a latent defect: the register effect depends on `[target]`, so every target change unregisters and re-registers the entry with `current = target` (rafAnimationEngine.ts:95-101 sets current=target=initialValue and writes immediately), making the second effect's `setAnimationTarget` a guaranteed no-op — the value snaps, never springs.
- **Impact**: ~37 dead lines shipped in the bundle via the barrel, plus a trap: the next developer who adopts it gets no animation and will burn time debugging the engine instead of the hook.
- **Fix sketch**: Delete the file and the barrel export line. If a render-value spring is still wanted later, reimplement with `registerAnimation` in a `[]`-dep effect (initial value from a ref) and let the `[target]` effect drive `setAnimationTarget`.

## 4. useCopyToClipboard and useKeyedCopyFlag duplicate the copy-then-timed-reset machinery
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/hooks/utility/interaction/useKeyedCopyFlag.ts:20
- **Scenario**: Both hooks implement the identical pattern — `copyText`, success-gated setState, `clearTimeout`/`setTimeout` reset, unmount cleanup effect — differing only in `boolean` vs `K | null` state. Any future change (e.g. abort on key change, feedback duration source) must be made twice; both are widely used (~20 and ~7 call sites).
- **Root cause**: The keyed variant was written as a parallel copy of the boolean one instead of the boolean one becoming a specialization.
- **Impact**: ~25 duplicated lines and a drift hazard between two hooks documented as siblings.
- **Fix sketch**: Reimplement `useCopyToClipboard` as `const { copiedKey, copy: copyKeyed } = useKeyedCopyFlag<true>(timeout)` returning `{ copied: copiedKey === true, copy: (text) => copyKeyed(true, text) }` (wrap `copy` in `useCallback`). Public APIs of both hooks stay byte-identical for callers.

## 5. useEndReached re-attaches its listener on every callback identity change, contradicting its own ref pattern
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/hooks/utility/interaction/useEndReached.ts:63
- **Scenario**: The hook routes the callback through `cbRef` precisely so "the listener is attached once" (its doc, lines 14-16), yet `onEndReached` sits in the effect deps, so every identity change (which the doc says is typical — handlers change as data grows) detaches/re-attaches the scroll listener and re-runs the on-attach `check()`.
- **Root cause**: `onEndReached` is needed in the effect only as a boolean (attached vs detached), but the raw function is used as the dep, making identity changes semantically meaningful when they shouldn't be.
- **Impact**: Mostly wasted work (listener churn per page load), but the extra `check()` on each re-attach can fire an additional `onEndReached` while the user sits near the bottom — callers are told to pass `undefined` while loading, which masks it, so this is a hazard rather than a live bug.
- **Fix sketch**: Depend on `Boolean(onEndReached)` instead of the function: `const attached = enabled && !!onEndReached;` and use `[scrollRef, attached, threshold]` as deps, keeping the internal `if (!el || !attached) return;` guard. The ref already delivers the fresh closure.
