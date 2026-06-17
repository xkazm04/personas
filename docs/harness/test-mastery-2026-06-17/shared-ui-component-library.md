# Test Mastery — Shared UI Component Library
> Total: 8 findings (1 critical, 3 high, 3 medium, 1 low)

Context: the 173/204-component reusable UI library under `src/features/shared/components/`. **Every feature builds on it**, so a silent regression here has the widest blast radius in the app. The repo has a mature vitest setup (`vitest.config.ts`, `src/test/setup.ts` mocks Tauri, jsdom, ResizeObserver) and ~150 test files — yet of the 8 files in this context, **none has a test**. The only shared-component test that exists is `layout/DeferUntilIdle.test.tsx`. `useTranslation()` resolves real English strings synchronously from `englishSections.ts` (no mock needed for `en`), so component tests can assert on `t.common.*` / `t.shared.*` / `t.empty_states.*` copy directly — there is no test-infra excuse for the gap.

## 1. ConfirmDialog has no test for its double-fire guard on destructive actions
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/features/shared/components/feedback/ConfirmDialog.tsx:37-55
- **Current test state**: none
- **Scenario**: `ConfirmDialog` is the app's standard confirmation surface for destructive/irreversible actions (it replaces native `confirm()`). Its entire `busy` state machine exists to guarantee a destructive `onConfirm` fires **exactly once** even under double-click / trackpad bounce / impatient retry: `handleConfirm` returns early if `busy`, sets `busy` before awaiting, and re-enables in `finally` so a throw lets the user retry; `handleCancel` also no-ops while `busy`. If a refactor drops the `if (busy) return` guard or moves `setBusy(true)` after the `await`, a user double-clicking "Delete" deletes twice — and nothing fails.
- **Root cause**: the guard is async/timing logic that only manifests under rapid input; there is no test exercising concurrent clicks or the throw-then-retry path, so the regression is invisible to CI.
- **Impact**: duplicate destructive operations (double delete/revoke/rollback), or a stuck-disabled dialog if `finally` is dropped — directly user-visible data loss on the app's most safety-critical primitive.
- **Fix sketch**: `*.test.tsx` rendering `<ConfirmDialog>` with an `onConfirm` that returns a controllable deferred promise. Assert: (a) two synchronous clicks on Confirm call `onConfirm` once; (b) both buttons are `disabled` / `aria-busy` while pending; (c) Cancel is ignored while busy; (d) after `onConfirm` rejects, buttons re-enable and a second click is allowed; (e) `confirmLabel`/`cancelLabel` override `t.common.confirm`/`t.common.cancel`. Invariant: **a single dialog instance dispatches at most one in-flight confirm.**

## 2. AriaLiveProvider announcement queue/drain is untested — screen-reader regressions are silent
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/shared/components/feedback/AriaLiveProvider.tsx:39-90, 147-160
- **Current test state**: none
- **Scenario**: This is the app-wide WCAG 4.1.3 announcement channel. It deliberately queues messages and drains one per 150ms with a per-message `key` bump so React's setState coalescing doesn't collapse a burst into a single utterance, and only the LAST-registered provider may null `_announce` on unmount (`if (_announce === announce)`). A regression that (a) drops the queue/key-remount, (b) breaks the timer drain, or (c) wrongly nulls the imperative handle silently stops screen readers from ever speaking — the live `<div role="status">` still renders, so it looks healthy: textbook success theater.
- **Root cause**: behavior is timer- + ref-driven and invisible in normal manual QA (most devs don't run a screen reader); no test uses fake timers to assert each queued message reaches a live region.
- **Fix sketch**: `*.test.tsx` with `vi.useFakeTimers()`: render provider + a consumer calling `useAnnounce()`; fire three `announce()` in one tick, `advanceTimersByTime` 0/150/300, assert each message lands in the correct (polite vs assertive) region with a changing `key`. Separately assert `useAnnounce()` throws outside the provider, and that `announceImperative` no-ops before mount but works after `_registerAnnounce`, and that unmounting a second provider does NOT silence the first. Invariant: **every announce() produces exactly one distinct live-region commit; the imperative handle survives provider churn.**

## 3. Button's disabled-reason / loading paths (a11y + double-submit guard) are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/shared/components/buttons/Button.tsx:126-249
- **Current test state**: none
- **Scenario**: `Button` is the canonical button used everywhere. Two business-relevant behaviors are untested: (1) `loading` forces `disabled` (`isDisabled = disabled || loading`) and sets `aria-busy` — this is the in-flight double-submit guard for every save/run/deploy CTA; if a refactor stops loading from disabling, users can fire a mutation twice. (2) When `disabled && disabledReason`, the inert button is wrapped in a focusable `Tooltip` span so the reason reaches mouse AND keyboard users (the disabled `<button>` can't surface it) — an accessibility contract. Neither the disable-on-loading nor the reason-wrapper path is asserted.
- **Root cause**: variant/size matrices look "obviously correct" so they get skipped; the load-bearing edge cases (loading→disabled, reason wrapper, loadingLabel swap) hide behind that assumption.
- **Fix sketch**: `*.test.tsx`: assert `loading` → button `disabled` + `aria-busy="true"` + onClick not fired; `loadingLabel` text replaces children while loading and children return after; `disabled` alone → no `aria-busy`; `disabled + disabledReason` renders the focusable tooltip wrapper (query the wrapper role/tabindex) while bare `disabled` does not; icon is hidden while loading. Invariant: **a loading Button cannot dispatch onClick, and a disabled-with-reason Button always exposes the reason to AT.**

## 4. No render-smoke / quality gate on the highest-blast-radius code in the app
- **Severity**: high
- **Category**: quality-gate
- **File**: src/features/shared/components/ (whole library; e.g. buttons/Button.tsx, feedback/ConfirmDialog.tsx, feedback/EmptyState.tsx)
- **Current test state**: none (1 of 173+ components has a test)
- **Scenario**: Every feature imports these primitives, so a crash-on-render or broken prop here fans out across the product, yet there is no coverage floor for `src/features/shared/components/**`. A bad merge (e.g. an undefined `VARIANT_CLASSES[variant]` lookup, a thrown hook) ships because nothing renders these in CI. A full backfill is overkill, but a thin smoke + new-code ratchet would catch the catastrophic class cheaply.
- **Root cause**: vitest `include` covers `src/**` but there is no per-area threshold or "every exported shared component renders" gate; coverage isn't even collected (no `coverage` block in `vitest.config.ts`).
- **Fix sketch**: add a parametrized smoke test that imports each top-level shared component and asserts `render(<C minimal-props/>)` does not throw (drive it off the CATALOG/barrel exports). Pair with an advisory per-area line/branch threshold for `src/features/shared/components/**` in `vitest.config.ts` `coverage`, blocking only on the smoke test (so it can't be gamed by assertion-free coverage) and ratcheting on new files. Keep it advisory on % to avoid bypass; block on "renders without throwing."

## 5. EmptyState scenario resolution + NoResults/InboxZero wrappers (pure prop logic) — LLM-generatable
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/shared/components/feedback/EmptyState.tsx:106-241
- **Current test state**: none
- **Scenario**: `EmptyState` resolves icon/title/subtitle/container from a `variant` scenario map with an explicit **props-override-scenario** precedence (`icon ?? scenario?.icon`, `title ?? scenario?.title ?? ''`, `subtitle ?? description ?? scenario?.subtitle`). `NoResults` wires the reset CTA; `InboxZero` gates its celebration animation behind BOTH `useReducedMotion()` and the app `reduceMotion` toggle (`celebrate && !prefersReducedMotion && !appReduceMotion`). A regression flipping precedence (scenario wins over explicit prop), or dropping a reduced-motion guard (motion forced on opted-out users), is pure-logic and easy to assert.
- **Root cause**: presentational component assumed trivial; the precedence chain and the dual motion gate are real invariants nobody pinned.
- **Fix sketch**: LLM-generatable batch. For each `EmptyStateVariant`: render and assert the scenario's English title/subtitle appear; then assert an explicit `title`/`icon`/`subtitle` prop overrides the scenario. `NoResults`: clicking the action calls `onReset` and label defaults to `t.empty_states.reset_filters`. `InboxZero`: with `useThemeStore` mocked, assert the `animate-inbox-zero-pop` class appears only when `celebrate && !reduceMotion` (mock both motion sources). Invariants: **explicit props always beat scenario defaults; the celebration pop never renders when either reduced-motion source is set.**

## 6. CopyButton managed-vs-internal mode + disabled short-circuit untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/shared/components/buttons/CopyButton.tsx:50-65
- **Current test state**: none
- **Scenario**: `CopyButton` is the one sanctioned wrapper over `navigator.clipboard`. It has two modes resolved by `isManaged = externalCopied !== undefined`: managed mode calls `externalOnCopy`; unmanaged calls `internal.copy(text)`. `handleClick` early-returns when `disabled`. A regression in the mode discriminant (e.g. calling internal copy in managed mode, or not short-circuiting on disabled) silently copies the wrong/stale text or fires a copy on a disabled control. The copied-label swap (`copiedLabel ?? t.shared.copy_copied`) and tooltip resolution are also unpinned.
- **Root cause**: clipboard is mocked away in tests by default, so nobody verified which handler actually fires per mode.
- **Fix sketch**: `*.test.tsx` stubbing `navigator.clipboard.writeText`: (a) unmanaged + `text` → click calls writeText with that text; (b) managed (`copied`/`onCopy` provided) → click calls `onCopy`, never writeText; (c) `disabled` → click fires neither; (d) `copied` state shows `copiedLabel`/`t.shared.copy_copied`. Invariant: **exactly one copy path fires per click, selected by the managed discriminant, and never when disabled.**

## 7. ErrorBanner variant routing + alert semantics untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/shared/components/feedback/ErrorBanner.tsx:23-68
- **Current test state**: none
- **Scenario**: `ErrorBanner` routes `variant='panel'` to a self-contained centered layout (with `role="alert"` / `aria-live="assertive"`, optional back + retry) and delegates `inline`/`banner` to `InlineErrorBanner` with `compact={variant==='inline'}`. A regression swapping the routing (e.g. inline rendering the panel, or losing `role="alert"`) means errors stop being announced or render with the wrong density. Retry/back/dismiss callback wiring across variants is also unverified.
- **Root cause**: a thin branching wrapper that "looks obvious"; the alert role and the `compact` flag mapping are the parts that actually matter for a11y and layout.
- **Fix sketch**: `*.test.tsx`: `variant='panel'` renders `role="alert"` + message + (when handlers passed) the localized retry (`t.common.retry`) and go-back (`t.common.go_back`) buttons that fire their callbacks; `variant='inline'` delegates to InlineErrorBanner in compact form (assert tighter padding marker / no panel layout) and `onDismiss` fires. Invariant: **error content is always announced via role=alert, and the variant maps to the intended layout/compactness.**

## 8. PanelTabBar tab semantics (disabled tab, aria-selected, per-instance layoutId) untested
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/shared/components/layout/PanelTabBar.tsx:19-64
- **Current test state**: none
- **Scenario**: Generic in-panel tab bar. A disabled tab must not call `onTabChange`; the active tab must carry `aria-selected={true}`; each instance derives a unique framer-motion `layoutId` from `useId()` so two tab bars on one screen don't make the underline teleport between them. Minor blast radius, but the disabled-click and aria-selected contracts are cheap to lock and prevent a no-op-looking accessibility/interaction regression.
- **Root cause**: small layout component, never pinned; framer-motion makes devs shy away from rendering it in tests (it renders fine under jsdom — see DeferUntilIdle precedent).
- **Fix sketch**: `*.test.tsx`: clicking an enabled tab calls `onTabChange(id)`; clicking a `disabled` tab does not; active tab has `aria-selected="true"` and others `"false"`; with `idPrefix`, tab/panel `id`/`aria-controls` are wired. (layoutId uniqueness is best left implicit — testing it couples to framer internals; assert behavior, not the generated id.) Invariant: **only enabled tabs dispatch changes; exactly one tab is aria-selected.**
