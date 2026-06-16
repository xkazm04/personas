# Bug Hunter — Shared UI Component Library

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: shared-ui-component-library | Group: Platform Foundation

## 1. ConfirmDialog has no in-flight guard — double-click confirms the action twice
- **Severity**: Critical
- **Category**: Race condition / double-submit
- **File**: `src/features/shared/components/feedback/ConfirmDialog.tsx:53` (confirm `<button>`)
- **Scenario**: A user clicks the confirm button on a destructive `ConfirmDialog`. The handler is async (e.g. `MemoriesPage` "Delete all": `onConfirm={async () => { await deleteAllMemories(); ... finally { setConfirmingDeleteAll(false) } }}`). While the network round-trip is in flight, the dialog stays mounted and the confirm button stays fully enabled. A second click (impatient user, double-click, trackpad bounce) fires `onConfirm` again → two `deleteAllMemories()` calls. The dialog only unmounts in the caller's `finally`, long after the second click is possible.
- **Root cause**: `ConfirmDialog` is a pure controlled component with zero internal state. It does not track "confirm pressed", does not disable the button after the first press, and does not await/observe `onConfirm`. Every consumer must remember to guard re-entrancy themselves, and the audited consumers (`MemoriesPage`, etc.) do not — they close the dialog only after the async work resolves.
- **Impact**: Multiplied across the entire app since this is THE shared confirm primitive. Double deletes, double POSTs, duplicate irreversible destructive actions. The danger-styled path (destructive ops) is exactly where double-submit hurts most.
- **Fix sketch**: Add an internal `const [busy, setBusy] = useState(false)` ref/state. On confirm: if `busy` return; set `busy`; `await Promise.resolve(onConfirm())`. Render `disabled={busy}` (and a spinner) on both buttons. Alternatively make `onConfirm` support returning a promise and disable while pending. This fixes every call site at once.

## 2. AriaLiveProvider unmount blindly nulls the global imperative handle
- **Severity**: High
- **Category**: Latent failure / silent no-op
- **File**: `src/features/shared/components/feedback/AriaLiveProvider.tsx:46-49`
- **Scenario**: The effect registers `_registerAnnounce(announce)` and its cleanup runs `_announce = null` unconditionally. Under React StrictMode (dev double-invoke), or any remount, or if a second provider ever mounts, the cleanup of the *old* instance nulls the global even though a *newer* instance just registered itself. After that, every `announceImperative(...)` call (used by `toastStore.ts` — i.e. all toast-driven screen-reader announcements) silently does nothing because `_announce?.(...)` short-circuits on null.
- **Root cause**: Register/unregister is not identity-checked. Cleanup should only null the handle if it still points at *this* provider's `announce` (`if (_announce === announce) _announce = null`). The current code assumes exactly one provider mounts exactly once for the app lifetime.
- **Impact**: Screen-reader users silently stop getting toast/status announcements after any provider remount — a WCAG 4.1.3 regression that is invisible to sighted QA and produces no error. App-wide because `toastStore` is the central notification channel.
- **Fix sketch**: Guard the cleanup: `return () => { if (_announce === announce) _announce = null; };`. Register the latest handle on every mount (already done) so the newest provider always wins.

## 3. Rapid consecutive announce() calls collapse — intermediate messages dropped silently
- **Severity**: High
- **Category**: Race condition / silent failure
- **File**: `src/features/shared/components/feedback/AriaLiveProvider.tsx:34-43`
- **Scenario**: Two `announce("A", "polite")` then `announce("B", "polite")` calls fire in the same tick (e.g. a store subscriber emitting two status updates, or a loop). React batches the two `setPoliteMessage` calls; only `"B"` survives to render. Worse: if the second message equals a message announced moments earlier, the `key` bump still re-mounts the node but the live region only ever reflects the last write — message "A" is never voiced. There is no queue and no flush-between-renders.
- **Root cause**: The live region holds a single string in state. Burst announcements within one batch overwrite each other; only the final `setState` of the batch reaches the DOM, so screen readers see one announcement instead of N. `aria-atomic="true"` + single-message state means no accumulation.
- **Impact**: Status messages are dropped for screen-reader users under any burst (multi-step flows, parallel async completions). Silent — no console error, sighted users see all the toasts. Affects every `useAnnounce`/`announceImperative` caller.
- **Fix sketch**: Maintain a small FIFO queue; drain one message per animation frame / short timer into the live region so each gets its own render cycle. Or append with a separator when announcements arrive within a debounce window. At minimum, document that callers must space announcements.

## 4. CopyButton shows "Copied" for empty string and trusts unchecked managed onCopy
- **Severity**: Medium
- **Category**: Edge case / silent failure / trust boundary
- **File**: `src/features/shared/components/buttons/CopyButton.tsx:58-65`
- **Scenario (a)**: With `text=""` (empty but defined), `handleClick` enters the `text !== undefined` branch and calls `internal.copy("")`. `navigator.clipboard.writeText("")` typically resolves, so the button flips to the emerald "Copied!" state — telling the user something was copied when the clipboard now holds nothing (or is unchanged on some browsers). **Scenario (b)**: In managed mode the component renders `copied ? copiedLabel : label` purely off the parent-supplied `copied` flag; if the parent's async copy actually failed but it set `copied=true` anyway, CopyButton happily shows success. The component performs no verification and surfaces no failure affordance in either mode.
- **Root cause**: No guard against empty/whitespace text, and the success indicator is decoupled from any real confirmation of clipboard write in managed mode. The internal hook does swallow real failures correctly (`if (!ok) return`), but offers the user no feedback that the copy failed — it just silently stays in the idle state, which reads as "my click did nothing."
- **Impact**: Users believe content was copied when it was empty or failed (no clipboard permission, insecure context, large payload rejected). App-wide because CopyButton is the shared copy affordance. Low-to-medium severity since data loss is unlikely, but the false-success is a trust erosion that repeats everywhere copy is offered.
- **Fix sketch**: Early-return / render disabled when `text` is empty after trim. On internal copy failure, briefly flash an error icon (the hook already returns `false`) rather than no-op silently. For managed mode, document that callers must only set `copied` after a verified write.

## 5. PanelTabBar shares one framer-motion layoutId across instances and lacks keyboard tab nav
- **Severity**: Low
- **Category**: Edge case / race condition
- **File**: `src/features/shared/components/layout/PanelTabBar.tsx:24,50`
- **Scenario**: `layoutIdPrefix` defaults to the constant `'panel-tab'`, so the animated underline uses `layoutId="panel-tab-underline"`. If two `PanelTabBar`s render on the same screen without a unique `layoutIdPrefix` (easy to forget — it is optional), framer-motion treats both underlines as the *same* shared-layout element and animates a single underline flying between the two tab bars whenever either changes. Separately, the `role="tab"` buttons have no roving `tabIndex` and no Arrow-key handler, so keyboard users must Tab through every tab instead of arrowing within the tablist (ARIA tabs pattern violation).
- **Root cause**: A non-unique default for a globally-scoped framer `layoutId`, plus a `role="tablist"`/`role="tab"` structure that implements the visual contract but not the keyboard interaction contract (no `onKeyDown`, no roving tabindex, no `aria-controls` target guarantee when `idPrefix` omitted).
- **Impact**: Rare visual glitch (underline teleporting between unrelated tab bars) for the layoutId collision; persistent minor a11y gap for keyboard/AT users on every tab bar. Low because both are non-data-affecting.
- **Fix sketch**: Default `layoutIdPrefix` to a per-instance `useId()` value instead of a constant. Add Arrow-Left/Right key handling with roving `tabIndex` (`tabIndex={active ? 0 : -1}`) to satisfy the WAI-ARIA tabs pattern.
