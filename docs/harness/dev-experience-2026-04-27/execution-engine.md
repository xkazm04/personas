# Execution Engine (client) — Dev Experience Scan

> Total: 9 · Critical: 0 · High: 4 · Medium: 4 · Low: 1
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Zero tests for the entire `src/features/execution` surface

- **Severity**: High
- **Category**: testing
- **File**: `src/features/execution/components/` (no `*.test.*` or `*.spec.*` siblings)
- **Scenario**: A dev refactors `ExecutionMiniPlayer` (drag math, expanded/collapsed branching, simple-vs-power mode, background executions bar, reasoning trace integration) — there is nothing to catch a regression. The only test in the broader area is `processActivitySlice.test.ts`, which only covers the `clearNonActive` predicate. PipelineDots, PreRunPreview keyboard contract, drag clamping, and the "show/hide" gate (`hasContent`) are entirely untested.
- **Root cause**: Feature folder was carved out without a test convention pass. Vitest + Testing Library are already in the toolchain (see other `__tests__` dirs).
- **Impact**: Every refactor in this feature is a manual click-test. With three components and ~640 LOC of conditional UI, that's a multiple-times-per-week tax.
- **Fix sketch**: Add three minimal RTL specs co-located with the components: (a) `ExecutionMiniPlayer.test.tsx` — render gate (`hasContent` false → null), simple vs power-mode branch, stop button calls `cancelExecution` with the active id; (b) `PipelineDots.test.tsx` — stage→color mapping including the `hasError` precedence over `isLast`; (c) `PreRunPreview.test.tsx` — Enter/Escape keyboard contract. Aim for one render-and-assert per branch, not snapshot dumps.

---

## 2. `ExecutionMiniPlayer` makes 14 separate Zustand subscriptions on every render

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:143-161`
- **Scenario**: The component reads `miniPlayerPinned`, `miniPlayerExpanded`, `miniPlayerPosition`, `unpinMiniPlayer`, `toggleMiniPlayerExpanded`, `setMiniPlayerPosition`, `isExecuting`, `executionOutput`, `activeExecutionId`, `executionPersonaId`, `pipelineTrace`, `cancelExecution`, `personas`, `backgroundExecutions` as 14 distinct selector calls. Any unrelated change to `agentStore` triggers re-evaluation of all 14 selectors per re-render.
- **Root cause**: Project memory notes "TaskRunner store pattern uses `useShallow` from zustand for selective subscriptions" but `useShallow` appears in only 5 files repo-wide (none in `features/execution`). The pattern hasn't propagated.
- **Impact**: Performance is fine today (selectors are cheap), but the *style* drift means new contributors will copy this 14-call pattern instead of the documented one. Also: every action method (`unpinMiniPlayer`, `toggleMiniPlayerExpanded`, `setMiniPlayerPosition`, `cancelExecution`) is subscribed individually, which is pure noise — actions are stable references.
- **Fix sketch**: Split into two `useShallow` reads — one for state (`{ isExecuting, executionOutput, activeExecutionId, ... }`), one for actions if you must read them through the store at all. Better: pull actions via `useAgentStore.getState()` inside callbacks since they don't need subscription. Document the convention in a short `src/stores/README.md` section so the next 14-selector component never gets written.

---

## 3. Inline copy-to-clipboard logic re-implements an existing hook

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:40-74`
- **Scenario**: `SimpleExecutionView` hand-rolls `copied` state, a `copiedTimerRef`, an unmount cleanup effect, and the `setCopied(true)` → `setTimeout(2000)` → `setCopied(false)` dance — exactly what `src/hooks/utility/interaction/useCopyToClipboard.ts` already provides (with `silentCatch` on the rejection path, which the inline version lacks).
- **Root cause**: Discoverability — `useCopyToClipboard` lives three levels deep under `hooks/utility/interaction/`. The author of this view didn't find it.
- **Impact**: 35 LOC of duplicate logic, plus a subtle bug: the inline `.then()` has no `.catch()`, so a clipboard rejection (insecure context, denied permission) is silently swallowed as an unhandled-promise warning in dev tools. The shared hook avoids this.
- **Fix sketch**: Replace the entire copy block with `const { copied, copy } = useCopyToClipboard(); const handleCopy = () => copy(executionOutput.join('\n'));`. Optionally add a barrel re-export at `src/hooks/utility/index.ts` so `import { useCopyToClipboard } from '@/hooks/utility'` works.

---

## 4. Hand-rolled drag implementation belongs in a shared hook

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/execution/components/ExecutionMiniPlayer.tsx:174-229`
- **Scenario**: 56 LOC implementing position drag with `mousedown`/`mousemove`/`mouseup`, viewport clamping, and cleanup. A grep shows 14 other files that do similar drag-handle work (canvas, timeline, alignment guides, persona matrix). Each one re-derives the `clientX`/`clientY` math, the document-level listeners, and the cleanup effect.
- **Root cause**: No `useDraggable` / `usePointerDrag` primitive in `hooks/utility/interaction/`, despite the obvious demand signal.
- **Impact**: Every dev who touches drag pays the "remember to add document-level cleanup, remember to clamp to viewport, remember to suppress when target is a button" tax. Touch support is also absent here (only mouse events) — a future "iPad-friendly mini player" PR has to fix every site.
- **Fix sketch**: Introduce `useDraggable({ position, setPosition, clamp: { width: 360, height: 80 } })` returning `{ onMouseDown, isDragging }`. Replace the inline impl, then opportunistically migrate the other 13 callsites in follow-ups. Add Pointer Events while you're at it for free touch support.

---

## 5. `PreRunPreview` Enter handler runs `onConfirm` even when readiness fails

- **Severity**: High
- **Category**: testing
- **File**: `src/features/execution/components/PreRunPreview.tsx:52-59`
- **Scenario**: The dialog shows missing-credential warnings via `check.missingCredentials.length > 0` but the global `keydown` handler unconditionally calls `onConfirm()` on Enter. A user with focus anywhere in the document can launch a run that the UI is actively warning against. Worse: there is no test, and the warnings render in a dim amber callout rather than disabling the Run button.
- **Root cause**: The "preview" abstraction was designed as a confirmation step but the gating logic for "is the preview *ready* to confirm" was never threaded through. The Run button at line 167 is also not disabled when readiness fails.
- **Impact**: Dev-experience consequence is doubled-up bug-hunt time: failures happen at the engine layer with cryptic "missing credential" errors instead of being caught at the click site. Repro is non-deterministic because Enter presses depend on focus state.
- **Fix sketch**: Compute `const isReady = check.missingCredentials.length === 0;` at the top, gate both the Enter handler and the Run button on it (`disabled={!isReady}`, `if (e.key === 'Enter' && isReady) onConfirm()`). Also `e.preventDefault()` on the Enter branch to avoid double submission when a focused input is inside the dialog. Add a small test asserting Enter is a no-op with missing credentials.

---

## 6. `PreRunPreview` lacks proper modal a11y / focus management

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/execution/components/PreRunPreview.tsx:62-83`
- **Scenario**: Dialog uses `role="dialog"` and an `aria-label` but: no `aria-modal="true"`, no `tabIndex={-1}` on the container, no initial focus on the Run/Cancel buttons, no focus trap. Tab from the dialog escapes to the page underneath. Six other files in the repo use modal patterns and most use a `FocusTrap` / `useFocusTrap` helper.
- **Root cause**: The component was a quick popover that grew dialog semantics but never adopted the focus-management convention.
- **Impact**: Dev tax via QA churn — accessibility audits flag this on every pass. Also: keyboard-only devs can't reliably navigate inside the dialog, which slows down internal demos.
- **Fix sketch**: Wrap children in the existing focus-trap helper used elsewhere (e.g. the helper hinted at by `aria-modal|FocusTrap|useFocusTrap` matches), add `aria-modal="true"`, focus the primary action on mount via a ref. If no shared focus-trap exists yet, this is a good moment to extract one — it's the third feature to need it.

---

## 7. `PipelineDots` Tooltip wrapper does not propagate `key`

- **Severity**: Medium
- **Category**: dev-loop-friction
- **File**: `src/features/execution/components/PipelineDots.tsx:32-53`
- **Scenario**: The `.map` has the `key` on the *inner* `<div>` (line 41) but the outer iterated element is the `<Tooltip>` (line 38). React's reconciler consumes the `key` from the immediate child of the array — meaning React sees no `key` here and emits the "Each child in a list should have a unique `key` prop" console warning during dev. That warning is *constant noise* whenever the mini player is mounted with a trace.
- **Root cause**: Refactor to wrap dots in tooltips moved the JSX but didn't move the key.
- **Impact**: Console-noise tax — devs grow numb to legitimate React warnings and miss real bugs. Also, Tooltip remounts on each render because React falls back to index-based keying, which means tooltip animation state resets unexpectedly on each pipeline-trace change.
- **Fix sketch**: Move `key={stage}` from the inner `<div>` up to the `<Tooltip>` element. One-line fix; pair it with a Tooltip prop test or eslint-plugin-react's `react/jsx-key` rule (run `npx eslint <file>` to confirm it's not yet caught — likely the rule isn't enforced).

---

## 8. No barrel export / public API for `features/execution`

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/execution/` (no `index.ts`)
- **Scenario**: Consumers reach into deep paths like `import ExecutionMiniPlayer from '@/features/execution/components/ExecutionMiniPlayer'`. There is no `src/features/execution/index.ts` declaring the public surface, and no README explaining what the feature owns vs. what lives in `lib/execution/`, `hooks/execution/`, or `stores/slices/agents/executionSlice.ts`.
- **Root cause**: Feature folders were created organically; no `feature/index.ts` convention exists yet for `execution` (some other features do have one).
- **Impact**: New devs ask "where does the execution logic live?" — the answer is split across 4 directories with overlapping names. Onboarding friction; also "internal vs external" boundary is unclear, so any internal refactor risks breaking unknown consumers.
- **Fix sketch**: Add `src/features/execution/index.ts` exporting the three components plus a one-page `README.md` mapping the four execution-related directories: `features/execution` (UI shell), `lib/execution` (pipeline trace + sink + state machine), `hooks/execution` (data subscriptions like `useReasoningTrace`), `stores/slices/agents/executionSlice.ts` (state). 15-minute write-up that pays back forever.

---

## 9. `Intl.NumberFormat` allocated on every `PreRunPreview` render

- **Severity**: Low
- **Category**: dev-loop-friction
- **File**: `src/features/execution/components/PreRunPreview.tsx:49`
- **Scenario**: `const currencyFmt = new Intl.NumberFormat(language, ...)` runs on every render. Cheap, but the formatter holds locale-data references and creates GC pressure during rapid re-renders (e.g. while a budget value updates live in a parent).
- **Root cause**: Common React paper-cut. No lint rule catches it.
- **Impact**: Marginal at best, but it's the kind of thing devs notice in profiler flames and fix piecemeal across the codebase. A documented "memoize Intl formatters" pattern would prevent ~20 similar instances.
- **Fix sketch**: `const currencyFmt = useMemo(() => new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }), [language]);`. Better: add a `useCurrencyFormatter(language)` helper to `hooks/utility/` and lint-check inline `new Intl.` constructors in JSX-adjacent code.
