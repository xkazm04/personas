# Shared UI Component Library — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 2, Low: 2)

## 1. ConfirmDialog swallows nothing but surfaces nothing: a failed destructive action rejects unhandled with zero user feedback
- **Severity**: High
- **Category**: bug
- **File**: src/features/shared/components/feedback/ConfirmDialog.tsx:42-49
- **Scenario**: User confirms a destructive action (dozens of call sites pass inline `async () => { ... }` handlers — delete-all in ManualReviewList, empty-trash in DrivePage, kill-process in FleetProcessScanner, revoke-peer in IdentitySettings). The Tauri invoke / API call rejects. `handleConfirm` wraps `onConfirm()` in `try { ... } finally { setBusy(false) }` with **no catch**: the rejection escapes the async click handler as an unhandled promise rejection, and the dialog simply re-enables its buttons.
- **Root cause**: The design assumes every caller catches its own errors, but the prop type `onConfirm: () => void | Promise<void>` actively invites bare async handlers, and the component's own contract ("re-enabling lets the user retry") acknowledges failure paths without rendering any failure state.
- **Impact**: Silent failure on destructive/irreversible flows: the user sees the busy state end and the dialog sit there (or they cancel out), believing the delete/revoke/kill happened or not with no signal either way. The error only lands in the console as an unhandled rejection.
- **Fix sketch**: Add `catch (err)` in `handleConfirm` that stores an error message in state and renders an `InlineErrorBanner` inside the dialog (plus `announceImperative(msg, 'assertive')`); keep the dialog open for retry.

## 2. EmptyState action buttons default to type="submit" — "Reset filters" inside a form submits the form
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/shared/components/feedback/EmptyState.tsx:164, 173
- **Scenario**: Any feature renders a filtered list (with the canonical `NoResults` recovery CTA) inside a `<form>` — e.g. a search/filter form like CreateMemoryForm or ResearchLabFormModal patterns. User clicks "Reset filters" (or the secondary action): the button has no `type` attribute, so the browser default `type="submit"` fires the form's submit handler in addition to `onClick`.
- **Root cause**: The two raw `<button>` elements omit `type="button"`, unlike sibling shared components (ConfirmDialog, ErrorBanner, CopyButton, Button all set it). A shared library primitive must be safe in every DOM context, including forms.
- **Impact**: Latent trap in the most-reused empty-state component: unintended form submission (validation firing, network calls, or default navigation) triggered by a CTA that was supposed to only reset local filter state.
- **Fix sketch**: Add `type="button"` to both action buttons — or better, render them via the shared `Button` component (variant `accent`/`ghost`), which also removes the duplicated hand-rolled button styling.

## 3. Button's "width-preserving loading" measures the wrong DOM — it locks the loading width, not the resting width
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/shared/components/buttons/Button.tsx:139-148
- **Scenario**: A form's submit button `<Button loading={saving} loadingLabel={t.common.saving}>Create persona and configure defaults</Button>` starts saving. The comment claims it "capture[s] the resting rect when loading starts so the button doesn't collapse", but `useLayoutEffect` runs **after** the commit in which the content already swapped to spinner + `loadingLabel`. `getBoundingClientRect()` therefore measures the already-collapsed loading width and locks `minWidth` to that — a no-op.
- **Root cause**: Measuring in an effect keyed on `loading` reads post-swap layout; the resting width is only observable in the render *before* `loading` flips (it would need to be tracked continuously, e.g. on every non-loading commit or via a ResizeObserver).
- **Impact**: Whenever `loadingLabel` is shorter than the children, the button still collapses and neighboring controls shift — exactly the layout jump the mechanism exists to prevent — then jumps back when loading ends. The feature silently does nothing (the only case it "works" is loadingLabel omitted, where width grows by the spinner).
- **Fix sketch**: Record `innerRef.current.getBoundingClientRect().width` in a ref on every commit where `loading` is false (same `useLayoutEffect`, measure-before-flag-update), and apply that stored value as `minWidth` when `loading` becomes true.

## 4. CopyButton shows two tooltips at once: native `title` plus the custom Tooltip wrapper
- **Severity**: Low
- **Category**: ui
- **File**: src/features/shared/components/buttons/CopyButton.tsx:76, 138-144
- **Scenario**: User hovers an icon-only CopyButton (no `label`) and pauses. `resolvedTooltip` is truthy, so the button gets both `title={resolvedTooltip}` (line 76) *and* a `<Tooltip content={...}>` wrapper (line 140). After the Tooltip's delay the styled tooltip appears; ~1s later the browser's native grey title tooltip appears next to it with the same text.
- **Root cause**: Belt-and-suspenders redundancy: the `title` attribute was kept as a fallback, but it always coexists with the custom Tooltip because both render from the same `resolvedTooltip` condition.
- **Impact**: Duplicate overlapping tooltips look broken and unpolished; the native one also ignores the `copied` state (still says "Copy" while the custom one says "Copied!").
- **Fix sketch**: Drop the `title` attribute whenever the custom Tooltip wraps the button (keep `aria-label={resolvedTooltip}` for icon-only accessibility instead — the button currently has no accessible name beyond `title`).

## 5. PanelTabBar disabled tabs are visually indistinguishable from enabled ones
- **Severity**: Low
- **Category**: ui
- **File**: src/features/shared/components/layout/PanelTabBar.tsx:76-82
- **Scenario**: A panel renders `tabs=[{...}, { id: 'history', label: 'History', disabled: true }]`. The disabled tab renders with `text-foreground cursor-not-allowed` — the same full-strength text color as every enabled inactive tab (`text-foreground`). At rest, nothing marks it disabled; the user only discovers it by hovering (no hover shift, not-allowed cursor) or clicking and getting nothing. Keyboard users skip it during arrow navigation with no visible explanation.
- **Root cause**: The disabled class branch only changes the cursor; it never dims or mutes the label, and the base inactive class already uses the same `text-foreground`.
- **Impact**: Broken affordance in a shared tablist: disabled tabs read as clickable, producing dead-click confusion; contradicts the disabled treatment used elsewhere in the library (`is-disabled` opacity on Button, `opacity-40` on CopyButton).
- **Fix sketch**: Give disabled tabs `text-muted-foreground/50` (or the project's `is-disabled` opacity utility) and consider a `disabledReason` tooltip pattern mirroring Button's, so the state is perceivable at rest.
