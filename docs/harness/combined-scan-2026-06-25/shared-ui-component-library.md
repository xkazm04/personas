# Shared UI Component Library — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: shared-ui-component-library | Group: Platform Foundation
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. CopyButton renders a double tooltip (native `title` + custom `<Tooltip>`), and the native one goes stale after copy
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: ui-correctness / amplified-primitive
- **File**: src/features/shared/components/buttons/CopyButton.tsx:76 (and :138)
- **Scenario**: Render any icon-only `<CopyButton text="..." />` (the most common usage). `tooltip` is unset and `label` is absent, so `resolvedTooltip` defaults to `t.shared.copy_tooltip` (line 71). The inner `<button>` is given `title={resolvedTooltip}` (line 76), AND because `resolvedTooltip` is truthy the whole button is wrapped in the custom `<Tooltip>` (line 138). On hover the browser shows its native OS tooltip *and* the app's styled tooltip simultaneously. After a successful copy, the custom Tooltip switches to `copy_copied_bang` ("Copied!") while the native `title` still says "Copy" — two contradictory tooltips on one control.
- **Root cause**: The component sets a native `title` attribute unconditionally *in addition to* delegating to the custom `<Tooltip>`, instead of choosing one mechanism. The `title` is never cleared/updated for the copied state.
- **Impact**: Visible double-tooltip + contradictory text on essentially every CopyButton in the app (icon-only is the default form). Degrades polish everywhere copy appears; the stale "Copy" title actively contradicts the "Copied!" feedback.
- **Fix sketch**: Drop `title={...}` from the button entirely and rely solely on the custom `<Tooltip>` (which already provides hover + the copied-state label). If a native fallback is wanted for the no-Tooltip path, only set `title` in the `return btn` branch where `resolvedTooltip` is falsy. Secondary: when `externalCopied !== undefined` but `externalOnCopy` is omitted, `handleClick` (line 58) is a silent no-op while the button still paints the copied state — guard or warn.
- **Value**: impact=5 effort=2

## 2. ConfirmDialog turns a rejecting `onConfirm` into an unhandled promise rejection
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling / silent-failure
- **File**: src/features/shared/components/feedback/ConfirmDialog.tsx:39-50
- **Scenario**: A caller wires a destructive action whose `onConfirm` can throw/reject (delete fails, network error). `handleConfirm` does `await Promise.resolve(onConfirm())` inside an `async` onClick with only a `finally` (no `catch`). When `onConfirm` rejects, the rejection propagates out of the async click handler — React does not await it, so it becomes a global `unhandledrejection`. The dialog re-enables (good for retry) but the user gets **no error feedback** and Sentry/console fills with uncaught rejections.
- **Root cause**: `handleConfirm` re-enables in `finally` but never `catch`es. The JSDoc (lines 11-15) and the inline comment (lines 45-47) explicitly anticipate the action throwing ("If it stayed open (e.g. the action threw)…"), yet the throw is left to escape rather than being surfaced or swallowed.
- **Impact**: Amplified across every destructive confirm in the app. Each failed confirm = one uncaught rejection (global handler noise) + a silent failure to the user, who only sees the buttons re-enable with no explanation.
- **Fix sketch**: Wrap the await in `try/catch`; on error, either surface it (callback prop `onError`, or render an inline error inside the dialog) or at minimum swallow via `silentCatch` so it does not become an unhandledrejection. Re-enable in `finally` as today. Document that callers should resolve, not reject, for "stay open + show error".
- **Value**: impact=5 effort=2

## 3. The canonical Button (and AsyncButton) has no synchronous double-submit guard, but the catalog implies AsyncButton "disables itself"
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: contract-ambiguity / double-submit
- **File**: src/features/shared/components/buttons/Button.tsx:126 ; src/features/shared/components/buttons/AsyncButton.tsx:62 ; src/features/shared/components/CATALOG.md:20
- **Scenario**: A developer follows the catalog ("Never style a raw `<button>`", line 21) and uses `<Button onClick={save}>`. `Button` only disables via `disabled || loading` — both **caller-supplied reactive props**. On a fast double-click, both native click events dispatch before React commits the `loading=true` re-render, so `onClick` fires twice → double-submit (double create/charge/delete). The catalog steers them to `AsyncButton` for async work, advertised as "disables **itself** while an async onClick is in flight" (line 20) — but `AsyncButton` *also* just forwards a caller-provided `isLoading` to `disabled` (AsyncButton.tsx:62). It does **not** wrap `onClick` or hold an internal in-flight ref, so it carries the identical pre-commit race and provides zero protection if the caller forgets to thread `isLoading`.
- **Root cause**: Neither component owns its in-flight state; correctness depends entirely on the caller wiring reactive `loading`/`isLoading`, which has an inherent React re-render race for rapid double-clicks. The catalog's "disables itself" wording over-promises a guarantee the component does not provide.
- **Impact**: Highest-blast-radius primitive in the app. Any mutating Button/AsyncButton is exposed to double-submit; the one component sold as the safe choice doesn't actually self-guard. High because double-submit on create/pay/delete corrupts data.
- **Fix sketch**: Give `AsyncButton` a real internal guard: wrap `onClick` so a synchronous `inFlightRef` blocks the second invocation until the returned promise settles (and drive its own `isLoading`). Then correct the catalog line to describe Button as *no* double-submit guard and AsyncButton as the guarded one. Cheapest interim: document at the Button call-site that mutations must use AsyncButton.
- **Value**: impact=8 effort=3

## 4. ErrorBanner silently drops `onDismiss` in the `panel` variant
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: contract-ambiguity / silent-failure
- **File**: src/features/shared/components/feedback/ErrorBanner.tsx:23-58 (prop declared :9)
- **Scenario**: `ErrorBannerProps` accepts `onDismiss` for all variants (line 9). A caller writes `<ErrorBanner variant="panel" message={…} onDismiss={close} />` expecting a dismiss affordance. The `panel` branch (lines 23-58) only ever renders `onBack` and `onRetry` — `onDismiss` is never referenced, so no dismiss button appears. The handler is silently ignored; the error cannot be dismissed and the caller gets no warning.
- **Root cause**: A prop valid for the `inline`/`banner` variants (passed through to `InlineErrorBanner`) is unimplemented in the `panel` branch, with no type-level or runtime signal that it's unsupported there.
- **Impact**: A surface that should be dismissible silently isn't. Low frequency (panel is the takeover variant) but a clean broken-contract trap — the dead prop reads as supported.
- **Fix sketch**: Either render a dismiss control in the panel branch when `onDismiss` is set, or make the variant contract explicit (e.g. narrow the type so `panel` cannot accept `onDismiss`, or JSDoc that `onDismiss` applies only to inline/banner).
- **Value**: impact=4 effort=2

## 5. AriaLiveProvider's single FIFO queue delays assertive (interrupting) announcements behind polite ones
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: accessibility / ordering-race
- **File**: src/features/shared/components/feedback/AriaLiveProvider.tsx:39-69 (spacing :58)
- **Scenario**: Code emits a burst, e.g. several `announce(status, 'polite')` then `announce('Credential test failed', 'assertive')` (the exact pair the hook doc shows, lines 130-133). All messages share one `queueRef` FIFO drained one-per-150ms (line 58). The assertive message — whose whole purpose is to *interrupt* — is written to its live region only after every queued polite message ahead of it, i.e. up to 150ms × N late. Worse, 150ms is far shorter than a real screen-reader utterance, so consecutive messages overwrite each region before the SR finishes speaking the prior one, dropping content the queue was meant to preserve.
- **Root cause**: Politeness is used only to pick which DOM region receives the text, not to prioritize drain order. Polite and assertive could be written to their *separate* regions concurrently, but the shared serialized queue forces assertive messages to wait their FIFO turn. The 150ms constant assumes utterances finish in 150ms, which they don't.
- **Impact**: Screen-reader users get urgent/error announcements late or out of priority, and rapid status bursts get truncated. Affects every feature that announces (the imperative API is used app-wide). Screen-reader-only, hence Medium not High.
- **Fix sketch**: Maintain two queues (or at least let assertive jump the queue / flush immediately to its own region), and/or key the spacing off region (assertive flushes promptly; polite spaces). Consider raising the inter-message spacing for same-region replacements so utterances aren't clobbered.
- **Value**: impact=5 effort=4
